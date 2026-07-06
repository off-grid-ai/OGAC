// Verify Keycloak-backed gateway API keys (`ogk_<clientId>.<secret>`) — dependency-free, ESM.
//
// Task #74: the gateway must accept MANY named x-api-keys, each backed by Keycloak, retiring the
// single static OFFGRID_GATEWAY_API_KEY. Each key is a Keycloak service-account client
// (client_credentials). We verify a key by attempting a client_credentials token exchange against
// the realm: HTTP 200 means the secret matches AND the client is enabled — so REVOKING a key (disable
// or delete the client in Keycloak) makes the exchange fail and the key stops working immediately.
// Keycloak is the single source of truth; the aggregator holds no key store.
//
// Results are cached briefly (positive + negative) so a burst of requests on one key doesn't hammer
// the token endpoint. The cache TTL is short enough that a revoke takes effect within ~KEY_CACHE_MS.

const KEY_PREFIX = 'ogk_';
const KEY_CLIENT_PREFIX = 'ogk-';
const KEY_CACHE_MS = 60 * 1000; // a revoke takes effect within a minute

// Parse `ogk_<clientId>.<secret>` → { clientId, secret } or null. Mirrors src/lib/gateway-api-key.ts
// parseApiKey (kept in lockstep — the raw .mjs can't import the TS module).
export function parseGatewayKey(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(KEY_PREFIX) || !raw.includes('.')) return null;
  const body = raw.slice(KEY_PREFIX.length);
  const dot = body.indexOf('.');
  if (dot <= 0) return null;
  const clientId = body.slice(0, dot);
  const secret = body.slice(dot + 1);
  if (!clientId || !secret || !clientId.startsWith(KEY_CLIENT_PREFIX)) return null;
  return { clientId, secret };
}

export function isGatewayKey(raw) {
  return parseGatewayKey(raw) !== null;
}

export class GatewayKeyVerifier {
  constructor({ url, realm }) {
    this.tokenUrl = `${url}/realms/${realm}/protocol/openid-connect/token`;
    this.cache = new Map(); // key(raw) -> { ok, at }
  }

  // True iff the raw key is a valid, active Keycloak-backed gateway key. Never throws.
  async verify(raw) {
    const parsed = parseGatewayKey(raw);
    if (!parsed) return false;

    const now = Date.now();
    const hit = this.cache.get(raw);
    if (hit && now - hit.at < KEY_CACHE_MS) return hit.ok;

    let ok = false;
    try {
      const r = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: parsed.clientId,
          client_secret: parsed.secret,
        }),
        signal: AbortSignal.timeout(5000),
      });
      ok = r.ok; // 200 = valid secret + enabled client; 401/400 = bad/revoked
    } catch {
      ok = false; // Keycloak unreachable → treat as not-authorized (fail closed)
    }

    this.cache.set(raw, { ok, at: now });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
    return ok;
  }
}

let singleton = null;
// Reads OFFGRID_KEYCLOAK_URL / _REALM; null when unconfigured (then only the static key / JWT paths
// remain). Shares the same env as the JWT verifier.
export function gatewayKeyVerifierFromEnv() {
  const url = process.env.OFFGRID_KEYCLOAK_URL;
  const realm = process.env.OFFGRID_KEYCLOAK_REALM;
  if (!url || !realm) return null;
  if (!singleton) singleton = new GatewayKeyVerifier({ url, realm });
  return singleton;
}
