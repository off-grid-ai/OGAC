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
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
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
  | { kind: 's3'; accessKey: string; secretKey: string }
  | { kind: 'none' };

export const NO_CREDENTIAL: ServiceCredential = { kind: 'none' };
