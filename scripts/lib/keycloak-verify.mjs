// Keycloak JWT verification — dependency-free (Node crypto only), ESM.
//
// Mirrors @offgrid/gateway's src/cluster/keycloak.ts for the standalone aggregator
// runtime (a raw .mjs, so it can't import the TS package). Fetches the realm JWKS
// once, caches keys, verifies RS256/ES256/PS256 without a network hop per request,
// and refreshes on unknown kid (rotation) or after the TTL.
import crypto from 'node:crypto';

const CACHE_TTL_MS = 10 * 60 * 1000;

function b64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function jwkToKey(jwk) {
  if (jwk.kty === 'RSA') return crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  if (jwk.kty === 'EC') return crypto.createPublicKey({ key: { kty: 'EC', x: jwk.x, y: jwk.y, crv: jwk.crv }, format: 'jwk' });
  throw new Error(`unsupported JWK: ${jwk.kty}`);
}

export class KeycloakVerifier {
  constructor({ url, realm, clientId }) {
    this.issuer = `${url}/realms/${realm}`;
    this.clientId = clientId || null;
    this.cache = null;
    this.fetching = null;
  }

  async #keys(kid) {
    const stale = !this.cache || Date.now() - this.cache.at > CACHE_TTL_MS;
    const unknown = kid && this.cache && !this.cache.keys.has(kid);
    if (stale || unknown) {
      if (!this.fetching) {
        this.fetching = (async () => {
          const r = await fetch(`${this.issuer}/protocol/openid-connect/certs`, { signal: AbortSignal.timeout(5000) });
          if (!r.ok) throw new Error(`JWKS ${r.status}`);
          const { keys } = await r.json();
          const map = new Map();
          for (const k of keys) if (k.use === 'sig' || !k.use) { try { map.set(k.kid, jwkToKey(k)); } catch { /* skip */ } }
          return { keys: map, at: Date.now() };
        })().finally(() => { this.fetching = null; });
      }
      this.cache = await this.fetching;
    }
    return this.cache;
  }

  // Returns decoded claims on success; throws otherwise.
  async verify(token) {
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error('malformed JWT');
    const header = JSON.parse(b64url(parts[0]).toString());
    const claims = JSON.parse(b64url(parts[1]).toString());

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) throw new Error('expired');
    if (claims.iss !== this.issuer) throw new Error(`issuer mismatch: ${claims.iss}`);
    if (this.clientId) {
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud ?? ''];
      if (!aud.includes(this.clientId) && claims.azp !== this.clientId) throw new Error('audience mismatch');
    }

    const cache = await this.#keys(header.kid);
    const key = header.kid ? cache.keys.get(header.kid) : [...cache.keys.values()][0];
    if (!key) throw new Error(`no key for kid=${header.kid}`);
    const alg = header.alg || 'RS256';
    const nodeAlg = alg.startsWith('ES') ? alg.replace('ES', 'SHA') : alg.replace('RS', 'SHA').replace('PS', 'SHA');
    const input = Buffer.from(`${parts[0]}.${parts[1]}`);
    const sig = b64url(parts[2]);
    const ok = alg.startsWith('PS')
      ? crypto.verify(nodeAlg, input, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }, sig)
      : crypto.verify(nodeAlg, input, key, sig);
    if (!ok) throw new Error('bad signature');
    return claims;
  }
}

let singleton = null;
// Reads OFFGRID_KEYCLOAK_URL / _REALM / _CLIENT_ID; null when unconfigured.
export function verifierFromEnv() {
  const url = process.env.OFFGRID_KEYCLOAK_URL;
  const realm = process.env.OFFGRID_KEYCLOAK_REALM;
  if (!url || !realm) return null;
  if (!singleton) singleton = new KeycloakVerifier({ url, realm, clientId: process.env.OFFGRID_KEYCLOAK_CLIENT_ID });
  return singleton;
}
