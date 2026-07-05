// Service-token broker — the single seam every service adapter authenticates through.
//
// Phase 4.10-A keystone (see docs/INTEGRATION_ARCHITECTURE.md). Instead of each adapter hard-coding
// its own auth (static gateway key, static Fleet token, anon S3, Langfuse keys in env), they all call
// `getServiceCredential(service)` and get back a ready-to-use credential — of the CORRECT KIND for
// that service. That "correct kind" is the crux: a Keycloak JWT is only valid for services that
// validate KC tokens (today just the aggregator/gateway). FleetDM wants its OWN API token, Langfuse
// wants Basic project keys, SeaweedFS wants S3 keys, and the no-auth images want nothing. Sending a KC
// JWT to any of those would BREAK them. So the broker is DRIVEN BY THE PURE `credentialPlan(service)`
// map — the single source of truth for what kind of credential a service takes:
//
//   • `bearer`  — either a Keycloak client_credentials JWT (plan 'oidc-jwt', minted from the client
//                 secret at `secret/<service>/client-secret`, cached + refreshed before expiry, with
//                 concurrent callers sharing ONE in-flight refresh) OR the service's OWN native API
//                 token (plan 'native-bearer', read verbatim from `secret/<service>/api-token`).
//   • `basic`   — a public/secret project keypair (plan 'native-basic', Langfuse) → HTTP Basic.
//   • `s3`      — SeaweedFS access/secret keypair (plan 's3'), so the broker is the one place SigV4
//                 material comes from too.
//   • `none`    — plan 'none' (no-auth image), or the secret isn't provisioned, or OpenBao/Keycloak is
//                 unreachable. Callers keep their existing fallback (static env key, anon loopback,
//                 legacy Basic) so NOTHING breaks pre-migration.
//
// SOLID split: all decisions — the per-service plan, lifecycle math (paths, grant shaping, exp
// parsing, refresh-due, cache entry), and shape selection — live pure + unit-tested in
// `service-credentials-lib.ts`. This module is the thin I/O shell: it reads OpenBao (reusing the
// secrets adapter's fetch — NOT a second copy), POSTs the grant to Keycloak, and holds the cache.

import { openBaoSecrets } from './adapters/secrets';
import {
  apiTokenKey,
  buildGrantRequest,
  clientSecretKey,
  computeCacheEntry,
  credentialPlan,
  decodeJwtExp,
  isRefreshDue,
  normalizeService,
  NO_CREDENTIAL,
  parseGrantResponse,
  publicKeyKey,
  resolveTokenEndpoint,
  s3AccessKeyKey,
  s3SecretKeyKey,
  secretKeyKey,
  type CachedToken,
  type GrantResponse,
  type ServiceCredential,
} from './service-credentials-lib';

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

// A service's OWN native API token (FleetDM etc.), read verbatim from OpenBao — NOT a Keycloak JWT.
async function getNativeBearer(service: string): Promise<ServiceCredential> {
  const token = await openBaoSecrets.get(apiTokenKey(service));
  if (token) return { kind: 'bearer', token };
  const legacy = legacyStaticToken(service);
  if (legacy) return { kind: 'bearer', token: legacy };
  return NO_CREDENTIAL;
}

// A service's Basic-auth project keypair (Langfuse pk:sk), from OpenBao. Both leaves required.
async function getNativeBasic(service: string): Promise<ServiceCredential> {
  const [publicKey, secretKey] = await Promise.all([
    openBaoSecrets.get(publicKeyKey(service)),
    openBaoSecrets.get(secretKeyKey(service)),
  ]);
  if (publicKey && secretKey) return { kind: 'basic', publicKey, secretKey };
  return NO_CREDENTIAL;
}

// The oidc-jwt path: mint (or reuse a cached) Keycloak client_credentials JWT.
async function getOidcBearer(service: string): Promise<ServiceCredential> {
  const entry = await getBearerEntry(service);
  if (entry) return { kind: 'bearer', token: entry.token };
  const legacy = legacyStaticToken(service);
  if (legacy) return { kind: 'bearer', token: legacy };
  return NO_CREDENTIAL;
}

/**
 * THE broker entry point. Consults the pure `credentialPlan(service)` for the KIND of credential the
 * service actually accepts, then produces exactly that kind:
 *   - 'oidc-jwt'      → `{ kind:'bearer' }` from a cached Keycloak client_credentials JWT (gateway)
 *   - 'native-bearer' → `{ kind:'bearer' }` from the service's OWN api-token in OpenBao (fleet)
 *   - 'native-basic'  → `{ kind:'basic' }` from the pk/sk project keypair in OpenBao (langfuse)
 *   - 's3'            → `{ kind:'s3' }` from the access/secret keypair in OpenBao (seaweedfs)
 *   - 'none'          → `{ kind:'none' }` (no-auth image, or the secret isn't provisioned yet)
 *
 * CRITICAL: a Keycloak JWT is ONLY minted for 'oidc-jwt' services. No other service ever receives a
 * KC JWT — it would break a backend that doesn't validate one. When a native secret isn't provisioned
 * the result is `none` and the adapter falls back to its legacy env credential — byte-identical to
 * today. Never throws — a broker failure degrades to `none`.
 */
export async function getServiceCredential(service: string): Promise<ServiceCredential> {
  const svc = normalizeService(service);
  try {
    const plan = credentialPlan(svc);
    switch (plan.mode) {
      case 'oidc-jwt':
        return await getOidcBearer(svc);
      case 'native-bearer':
        return await getNativeBearer(svc);
      case 'native-basic':
        return await getNativeBasic(svc);
      case 's3':
        return await getS3Credential(svc);
      case 'none':
        return NO_CREDENTIAL;
    }
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
