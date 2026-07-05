// Service-token broker — the single seam every service adapter authenticates through.
//
// Phase 4.10-A keystone (see docs/INTEGRATION_ARCHITECTURE.md). Instead of each adapter hard-coding
// its own auth (static gateway key, static Fleet token, anon S3, Langfuse keys in env), they all call
// `getServiceCredential(service)` and get back a ready-to-use credential:
//
//   • `bearer`  — a Keycloak client_credentials JWT, minted from the service's client secret (stored
//                 in OpenBao at `secret/<service>/client-secret`), cached in-memory and refreshed
//                 before expiry. Concurrent callers share ONE in-flight refresh.
//   • `s3`      — SeaweedFS access/secret keypair straight from OpenBao (no Keycloak), so the broker
//                 is the one place SigV4 material comes from too.
//   • `none`    — nothing configured / OpenBao or Keycloak unreachable. Callers keep their existing
//                 fallback (static env key, anon loopback) so NOTHING breaks pre-migration.
//
// SOLID split: all lifecycle math (paths, grant shaping, exp parsing, refresh-due, cache entry) lives
// pure and unit-tested in `service-credentials-lib.ts`. This module is the thin I/O shell: it reads
// OpenBao (reusing the secrets adapter's fetch — NOT a second copy), POSTs the grant to Keycloak, and
// holds the cache. Real functions, no mocks.

import { openBaoSecrets } from './adapters/secrets';
import {
  buildGrantRequest,
  clientSecretKey,
  computeCacheEntry,
  decodeJwtExp,
  isRefreshDue,
  normalizeService,
  NO_CREDENTIAL,
  parseGrantResponse,
  resolveTokenEndpoint,
  s3AccessKeyKey,
  s3SecretKeyKey,
  type CachedToken,
  type GrantResponse,
  type ServiceCredential,
} from './service-credentials-lib';

// Which broker path a service takes. SeaweedFS is S3 (keys, no Keycloak); everything else is a
// Keycloak-brokered bearer. A service absent from here still works — it defaults to the bearer path,
// and if it has no client secret in OpenBao it lands on the graceful `none` fallback.
const S3_SERVICES = new Set(['seaweedfs', 's3']);

// ── In-memory token cache + in-flight de-dup ──────────────────────────────────────────────────────
// One entry per service. `inflight` collapses concurrent refreshes into a single Keycloak round-trip.
const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<CachedToken | null>>();

/** The service-account client id for a service. Convention: `offgrid-<service>` (overridable). */
function clientIdFor(service: string): string {
  const svc = normalizeService(service);
  const override = process.env[`OFFGRID_${svc.toUpperCase().replace(/-/g, '_')}_CLIENT_ID`];
  return override ?? `offgrid-${svc}`;
}

/** Legacy static bearer, per service, so a `none` result can still degrade to today's behavior. */
function legacyStaticToken(service: string): string | undefined {
  const svc = normalizeService(service);
  // e.g. OFFGRID_GATEWAY_API_KEY, OFFGRID_FLEET_TOKEN — resolved by the caller today; the broker only
  // exposes it so a future caller can ask the broker for "whatever auth you have" uniformly.
  return process.env[`OFFGRID_${svc.toUpperCase().replace(/-/g, '_')}_STATIC_TOKEN`];
}

function tokenEndpoint(): string | null {
  return resolveTokenEndpoint({
    keycloakUrl: process.env.OFFGRID_KEYCLOAK_URL,
    realm: process.env.OFFGRID_KEYCLOAK_REALM,
    issuer: process.env.AUTH_KEYCLOAK_ISSUER,
  });
}

// ── Keycloak client_credentials grant (the one network call, isolated) ─────────────────────────────
async function mintToken(service: string, clientSecret: string): Promise<CachedToken | null> {
  const endpoint = tokenEndpoint();
  if (!endpoint) return null;
  const req = buildGrantRequest(clientIdFor(service), clientSecret);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const grant = parseGrantResponse((await res.json()) as GrantResponse);
    return computeCacheEntry(Date.now(), grant, decodeJwtExp(grant.token));
  } catch {
    return null;
  }
}

// Read the OpenBao-stored client secret via the SAME fetch the secrets adapter uses (no duplication).
// `openBaoSecrets.get` = baoGet, which falls back to process.env[key] when OpenBao is unreachable.
async function readClientSecret(service: string): Promise<string | undefined> {
  return openBaoSecrets.get(clientSecretKey(service));
}

/**
 * Fetch (or reuse) a Keycloak service JWT for `service`. Returns the cached entry when it's still
 * fresh; otherwise mints a new one, collapsing concurrent refreshes into a single in-flight promise so
 * a burst of callers triggers ONE grant. Returns null when the secret or Keycloak isn't available.
 */
async function getBearerEntry(service: string): Promise<CachedToken | null> {
  const svc = normalizeService(service);
  const cached = tokenCache.get(svc);
  if (!isRefreshDue(cached, Date.now())) return cached ?? null;

  const existing = inflight.get(svc);
  if (existing) return existing;

  const refresh = (async (): Promise<CachedToken | null> => {
    const secret = await readClientSecret(svc);
    if (!secret) return null;
    const entry = await mintToken(svc, secret);
    if (entry) tokenCache.set(svc, entry);
    return entry;
  })().finally(() => {
    inflight.delete(svc);
  });

  inflight.set(svc, refresh);
  return refresh;
}

async function getS3Credential(service: string): Promise<ServiceCredential> {
  const [accessKey, secretKey] = await Promise.all([
    openBaoSecrets.get(s3AccessKeyKey(service)),
    openBaoSecrets.get(s3SecretKeyKey(service)),
  ]);
  if (accessKey && secretKey) return { kind: 's3', accessKey, secretKey };
  return NO_CREDENTIAL;
}

/**
 * THE broker entry point. Return a ready-to-use credential for `service`:
 *   - SeaweedFS/S3 → `{ kind:'s3', accessKey, secretKey }` (from OpenBao, no Keycloak)
 *   - everything else → `{ kind:'bearer', token }` (Keycloak client_credentials, cached)
 *   - nothing configured / unreachable → `{ kind:'none' }` (or a legacy static token when one is set)
 *
 * Never throws — a broker failure degrades to `none` so callers keep working exactly as today until
 * Phase B swaps them over.
 */
export async function getServiceCredential(service: string): Promise<ServiceCredential> {
  const svc = normalizeService(service);
  try {
    if (S3_SERVICES.has(svc)) return await getS3Credential(svc);

    const entry = await getBearerEntry(svc);
    if (entry) return { kind: 'bearer', token: entry.token };

    const legacy = legacyStaticToken(svc);
    if (legacy) return { kind: 'bearer', token: legacy };
    return NO_CREDENTIAL;
  } catch {
    return NO_CREDENTIAL;
  }
}

/** Drop the cached token for a service (e.g. after a 401 forces a re-mint). Test/ops hook. */
export function invalidateServiceCredential(service: string): void {
  tokenCache.delete(normalizeService(service));
}

/** Clear the whole cache. Primarily for tests. */
export function _clearServiceCredentialCache(): void {
  tokenCache.clear();
  inflight.clear();
}

export type { ServiceCredential } from './service-credentials-lib';
