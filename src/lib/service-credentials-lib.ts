// PURE service-credential broker logic — ZERO imports, ZERO I/O, fully unit-testable.
//
// This is the token-lifecycle brain behind `service-credentials.ts` (the I/O shell). Everything here
// is a plain function over plain data: OpenBao secret-path convention, Keycloak client_credentials
// request/response shaping, JWT `exp` parsing, and the refresh-due decision + cache entry. The shell
// does the fetch()es; this decides WHAT to send, HOW to read what came back, and WHEN a cached token
// is still good. Keeping it pure is what lets us test the whole lifecycle with no network, no mocks.

// ── OpenBao secret-path convention ───────────────────────────────────────────────────────────────
// Every service's credential lives under `secret/<service>/<leaf>` (KV v2). The console's SecretsPort
// keys off the logical key AFTER the mount (`baoGet('<service>/<leaf>')` → GET <mount>/data/<key>), so
// these builders return that logical key, not the full API path.

/** Normalize a service name for use in a key / cache lookup: trimmed, lowercased. */
export function normalizeService(service: string): string {
  return service.trim().toLowerCase();
}

/** Logical KV key for a service's Keycloak client secret: `<service>/client-secret`. */
export function clientSecretKey(service: string): string {
  return `${normalizeService(service)}/client-secret`;
}

/** Logical KV key for a service's S3 access key id (SeaweedFS): `<service>/s3-access-key`. */
export function s3AccessKeyKey(service: string): string {
  return `${normalizeService(service)}/s3-access-key`;
}

/** Logical KV key for a service's S3 secret key (SeaweedFS): `<service>/s3-secret-key`. */
export function s3SecretKeyKey(service: string): string {
  return `${normalizeService(service)}/s3-secret-key`;
}

/**
 * Logical KV key for a service's NATIVE API token (FleetDM, Unleash admin, …): `<service>/api-token`.
 * This is the service's OWN token — NOT a Keycloak JWT — sent verbatim as its Authorization bearer.
 */
export function apiTokenKey(service: string): string {
  return `${normalizeService(service)}/api-token`;
}

/** Logical KV key for a service's Basic-auth public key id (Langfuse project key): `<service>/public-key`. */
export function publicKeyKey(service: string): string {
  return `${normalizeService(service)}/public-key`;
}

/** Logical KV key for a service's Basic-auth secret key (Langfuse project key): `<service>/secret-key`. */
export function secretKeyKey(service: string): string {
  return `${normalizeService(service)}/secret-key`;
}

// ── Per-service credential PLAN (the single source of truth) ─────────────────────────────────────
// The design gap this closes: a KC JWT is ONLY valid for services that validate Keycloak tokens.
// Today that's just the aggregator (gateway). Every other backend authenticates with its OWN native
// credential — sending it a KC JWT would BREAK it. So the broker must not blindly mint a JWT for any
// service with a secret in OpenBao; it must first ask THIS map what KIND of credential the service
// wants, then fetch/mint accordingly.
//
//   'oidc-jwt'     — mint a Keycloak client_credentials JWT (the service validates KC tokens).
//   'native-bearer'— the service's OWN opaque API token, sent verbatim as `Authorization: Bearer`.
//   'native-basic' — a public/secret keypair → HTTP Basic (Langfuse project keys).
//   's3'           — SeaweedFS access/secret keypair for SigV4 signing.
//   'none'         — no auth today (trusted-LAN, no-auth image). See the Phase-D TODO below.
//
// `baoPath` names the LOGICAL KV key the shell reads for a NATIVE plan; for 'oidc-jwt' it's the
// client-secret path, for 'native-basic'/'s3' the shell reads the TWO keypair leaves under the same
// `<service>/` prefix (baoPath points at the primary leaf for documentation/uniformity).

export type CredentialMode = 'oidc-jwt' | 'native-bearer' | 'native-basic' | 's3' | 'none';

export interface CredentialPlan {
  mode: CredentialMode;
  /** Primary logical KV key the shell reads (or mints from, for oidc-jwt). Undefined for 'none'. */
  baoPath?: string;
}

// The declarative map. Verified against docs/INTEGRATION_ARCHITECTURE.md's per-service auth matrix.
// A service ABSENT from here is treated as 'none' (fail-safe: no wrong-kind credential is ever sent).
const PLAN_MODES: Record<string, CredentialMode> = {
  // Only the aggregator validates a Keycloak JWT today (scripts/lib/keycloak-verify.mjs).
  gateway: 'oidc-jwt',
  // FleetDM authenticates its REST API with its OWN token — a KC JWT would 401 it.
  fleet: 'native-bearer',
  // Langfuse public REST API is HTTP Basic over project keys (pk:sk) — no OIDC.
  langfuse: 'native-basic',
  // SeaweedFS S3 IAM is access/secret keys (SigV4) — no OIDC.
  seaweedfs: 's3',
  s3: 's3',
  // Phase-D DONE for OpenSearch (2026-07-25): its security plugin is ENABLED on the fleet and it
  // validates Keycloak JWTs natively (jwt auth domain, required_audience offgrid-opensearch, the
  // service account mapped to all_access). The REST layer deliberately stays plain HTTP on this
  // deployment, so the console sends a Bearer over loopback — no demo-cert trust problem. Every
  // OpenSearch call routes through lib/opensearch-http.ts, which reads this plan.
  opensearch: 'oidc-jwt',
  // Marquez/OPA/Presidio stay edge-gated (Caddy forward_auth) or behind a console proxy — none of them
  // validate a KC JWT today, so they MUST remain 'none' or we'd send a credential they can't verify.
  marquez: 'none',
  opa: 'none',
  presidio: 'none',
};

/**
 * The credential plan for a service (pure). Returns the KIND of credential the service actually
 * accepts + the logical OpenBao key to read/mint from. Unknown services fail safe to 'none' so the
 * broker never sends a wrong-kind credential to a service that can't validate it.
 */
export function credentialPlan(service: string): CredentialPlan {
  const svc = normalizeService(service);
  const mode = PLAN_MODES[svc] ?? 'none';
  switch (mode) {
    case 'oidc-jwt':
      return { mode, baoPath: clientSecretKey(svc) };
    case 'native-bearer':
      return { mode, baoPath: apiTokenKey(svc) };
    case 'native-basic':
      return { mode, baoPath: publicKeyKey(svc) };
    case 's3':
      return { mode, baoPath: s3AccessKeyKey(svc) };
    case 'none':
      return { mode };
  }
}

// ── Keycloak token endpoint ──────────────────────────────────────────────────────────────────────
// Two env shapes exist in the repo: OFFGRID_KEYCLOAK_URL + _REALM (the admin client) or the OIDC
// issuer AUTH_KEYCLOAK_ISSUER (which already IS the realm URL). Derive the token endpoint from
// whichever is present so the broker never hard-codes a host — it follows the same convention the rest
// of the console uses (mDNS `offgrid-s1.local` / loopback come from the env value, not from here).

const TOKEN_SUFFIX = '/protocol/openid-connect/token';

/**
 * Resolve the realm token endpoint from env values (pure — env is passed in). Prefers explicit
 * base+realm; falls back to the OIDC issuer (which already IS the realm URL). Returns null when
 * neither is configured so the shell can fall back gracefully.
 */
export function resolveTokenEndpoint(env: {
  keycloakUrl?: string;
  realm?: string;
  issuer?: string;
}): string | null {
  const base = env.keycloakUrl?.trim().replace(/\/+$/, '');
  const realm = env.realm?.trim();
  if (base && realm) {
    return `${base}/realms/${encodeURIComponent(realm)}${TOKEN_SUFFIX}`;
  }
  const issuer = env.issuer?.trim().replace(/\/+$/, '');
  if (issuer) {
    // The issuer is already `<base>/realms/<realm>` — append the token path directly.
    return `${issuer}${TOKEN_SUFFIX}`;
  }
  return null;
}

// ── client_credentials grant shaping ─────────────────────────────────────────────────────────────

export interface GrantRequest {
  /** x-www-form-urlencoded body for a POST to the token endpoint. */
  body: string;
  headers: Record<string, string>;
}

/**
 * Shape a client_credentials grant request (pure). Mirrors the grant in keycloak-admin.ts but returns
 * the ready-to-send body/headers instead of performing the fetch, so it's unit-testable. Optionally
 * requests a specific scope/audience (used when a downstream needs its own audience claim).
 */
export function buildGrantRequest(
  clientId: string,
  clientSecret: string,
  opts?: { scope?: string; audience?: string },
): GrantRequest {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (opts?.scope) params.set('scope', opts.scope);
  if (opts?.audience) params.set('audience', opts.audience);
  return {
    body: params.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  };
}

export interface GrantResponse {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
}

export interface ParsedGrant {
  token: string;
  /** Lifetime in seconds as reported by the grant (expires_in). */
  expiresIn: number;
}

/**
 * Read a Keycloak token response (pure). Throws a descriptive error on a malformed/empty grant so the
 * shell surfaces "bad grant" rather than caching an undefined token. Defaults a missing/garbage
 * expires_in to a conservative 60s (Keycloak always sends it, but never trust the wire).
 */
export function parseGrantResponse(json: GrantResponse | null | undefined): ParsedGrant {
  const token = typeof json?.access_token === 'string' ? json.access_token : '';
  if (!token) throw new Error('Keycloak grant returned no access_token');
  const rawExp = json?.expires_in;
  const expiresIn = typeof rawExp === 'number' && rawExp > 0 ? rawExp : 60;
  return { token, expiresIn };
}

// ── JWT exp parsing ──────────────────────────────────────────────────────────────────────────────

/**
 * Decode a JWT's `exp` claim (seconds since epoch) WITHOUT verifying the signature — we minted this
 * token from Keycloak over TLS, so we trust it; we only need the expiry for cache scheduling. Returns
 * null if the token isn't a well-formed JWT or has no numeric exp (the caller then falls back to the
 * grant's expires_in). Pure: base64url-decodes the payload segment with atob.
 */
export function decodeJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payloadB64 = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof json.exp === 'number' && json.exp > 0 ? json.exp : null;
  } catch {
    return null;
  }
}

// ── Cache entry + refresh-due decision ─────────────────────────────────────────────────────────────

export interface CachedToken {
  token: string;
  /** Absolute expiry, ms epoch. */
  expiresAtMs: number;
  /** Absolute time we should proactively refresh, ms epoch (a fraction of the lifetime before exp). */
  refreshAtMs: number;
}

const DEFAULT_REFRESH_FRACTION = 0.8; // refresh once 80% of the token's life has elapsed

/**
 * Compute a cache entry from a freshly-minted grant (pure). Prefers the JWT's own `exp` over the
 * grant's expires_in when both are present (they normally agree; exp is the authoritative claim).
 * `refreshAtMs` sits at `fraction` of the lifetime measured from issue time, clamped so we never
 * schedule a refresh in the past or after expiry.
 *
 * @param nowMs           current time, ms epoch (injected — no Date.now() here, keeps it pure/testable)
 * @param grant           parsed grant (token + expires_in seconds)
 * @param jwtExpSeconds   exp claim decoded from the token, or null
 * @param refreshFraction 0..1 of the lifetime after which we refresh (default 0.8)
 */
export function computeCacheEntry(
  nowMs: number,
  grant: ParsedGrant,
  jwtExpSeconds: number | null,
  refreshFraction: number = DEFAULT_REFRESH_FRACTION,
): CachedToken {
  const expiresAtMs =
    jwtExpSeconds !== null ? jwtExpSeconds * 1000 : nowMs + grant.expiresIn * 1000;
  const lifetimeMs = Math.max(0, expiresAtMs - nowMs);
  const frac = Math.min(1, Math.max(0, refreshFraction));
  const refreshAtMs = nowMs + Math.floor(lifetimeMs * frac);
  return { token: grant.token, expiresAtMs, refreshAtMs };
}

/**
 * Is a cached token due for refresh at `nowMs`? True when we've passed the proactive refresh point OR
 * the token is already expired. A null entry (never fetched) is always "due". Pure.
 */
export function isRefreshDue(entry: CachedToken | null | undefined, nowMs: number): boolean {
  if (!entry) return true;
  return nowMs >= entry.refreshAtMs || nowMs >= entry.expiresAtMs;
}

// ── Result types (the broker's public contract) ──────────────────────────────────────────────────
// The one shape every downstream adapter reads. `bearer` for Keycloak-brokered services, `s3` for
// SeaweedFS SigV4, `none` when nothing is configured (pre-migration / unreachable) — callers keep
// their existing fallback behavior when they see `none`.

export type ServiceCredential =
  | { kind: 'bearer'; token: string }
  | { kind: 'basic'; publicKey: string; secretKey: string }
  | { kind: 's3'; accessKey: string; secretKey: string }
  | { kind: 'none' };

export const NO_CREDENTIAL: ServiceCredential = { kind: 'none' };

// ── PURE auth-selection rules (Phase 4.10-B) ────────────────────────────────────────────────────────
// The one decision every adapter shares: given a broker credential and the adapter's LEGACY fallback,
// what auth do we attach? Kept pure + zero-I/O so it's unit-tested with no network. The rule is
// uniform: a broker credential wins; otherwise the adapter's existing static/env auth is used
// UNCHANGED; otherwise no auth at all. When the broker returns `none` (the current, unprovisioned
// reality) the output is byte-identical to what the adapter sent before this phase.

/**
 * Gateway auth headers. Broker Bearer JWT wins (the aggregator already accepts Keycloak JWTs);
 * else the legacy static `OFFGRID_GATEWAY_API_KEY` as `x-api-key`; else no auth header.
 */
export function chooseGatewayAuth(
  cred: ServiceCredential,
  legacyApiKey: string | undefined,
): Record<string, string> {
  if (cred.kind === 'bearer' && cred.token) return { authorization: `Bearer ${cred.token}` };
  if (legacyApiKey) return { 'x-api-key': legacyApiKey };
  return {};
}

/**
 * FleetDM bearer token to hand to `fleetHeaders()`. Broker Bearer wins; else the legacy static
 * `OFFGRID_FLEET_TOKEN` / `FLEET_TOKEN`; else undefined (→ no Authorization header, unchanged).
 */
export function chooseFleetToken(
  cred: ServiceCredential,
  legacyToken: string | undefined,
): string | undefined {
  if (cred.kind === 'bearer' && cred.token) return cred.token;
  return legacyToken;
}

/**
 * Langfuse Basic-auth header. Broker `basic` project keypair wins (publicKey:secretKey = pk:sk);
 * else the caller's existing env-derived Basic header UNCHANGED; else null. `b64` is injected
 * (Buffer/btoa) to keep this pure. Returns the full `Basic <base64(pk:sk)>` value.
 */
export function chooseLangfuseAuth(
  cred: ServiceCredential,
  legacyBasic: string | null,
  b64: (s: string) => string,
): string | null {
  if (cred.kind === 'basic' && cred.publicKey && cred.secretKey) {
    return `Basic ${b64(`${cred.publicKey}:${cred.secretKey}`)}`;
  }
  return legacyBasic;
}
