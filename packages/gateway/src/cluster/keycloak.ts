// Keycloak JWT validation — no external deps, Node crypto only.
//
// Fetches the realm's JWKS once, caches the public keys, and verifies RS256/ES256
// JWTs on every request without a network hop. Keys are refreshed when a kid is
// unknown (key rotation) or after CACHE_TTL_MS.
import crypto from 'crypto';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface JWK {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;   // RSA modulus (base64url)
  e?: string;   // RSA exponent (base64url)
  x?: string;   // EC x (base64url)
  y?: string;   // EC y (base64url)
  crv?: string; // EC curve
}

interface KeyCache {
  keys: Map<string, crypto.KeyObject>;
  fetchedAt: number;
}

export interface KeycloakConfig {
  url: string;       // e.g. https://sso.example.com
  realm: string;     // e.g. offgrid
  clientId?: string; // optional: enforce aud claim
}

export interface JWTClaims {
  sub: string;
  azp?: string;         // authorized party (client ID)
  preferred_username?: string;
  email?: string;
  scope?: string;
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
  exp: number;
  iat: number;
  iss: string;
  aud?: string | string[];
  [k: string]: unknown;
}

function b64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function jwkToPublicKey(jwk: JWK): crypto.KeyObject {
  if (jwk.kty === 'RSA' && jwk.n && jwk.e) {
    return crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  }
  if (jwk.kty === 'EC' && jwk.x && jwk.y && jwk.crv) {
    return crypto.createPublicKey({ key: { kty: 'EC', x: jwk.x, y: jwk.y, crv: jwk.crv }, format: 'jwk' });
  }
  throw new Error(`Unsupported JWK type: ${jwk.kty}`);
}

export class KeycloakValidator {
  private cache: KeyCache | null = null;
  private fetching: Promise<KeyCache> | null = null;
  readonly issuer: string;

  constructor(readonly config: KeycloakConfig) {
    this.issuer = `${config.url}/realms/${config.realm}`;
  }

  private jwksUrl(): string {
    return `${this.issuer}/protocol/openid-connect/certs`;
  }

  private async fetchKeys(): Promise<KeyCache> {
    const r = await fetch(this.jwksUrl(), { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`JWKS fetch failed: ${r.status}`);
    const { keys } = (await r.json()) as { keys: JWK[] };
    const map = new Map<string, crypto.KeyObject>();
    for (const jwk of keys) {
      if (jwk.use === 'sig' || !jwk.use) {
        try { map.set(jwk.kid, jwkToPublicKey(jwk)); } catch { /* skip unsupported */ }
      }
    }
    return { keys: map, fetchedAt: Date.now() };
  }

  private async getKeys(kid?: string): Promise<KeyCache> {
    const stale = !this.cache || Date.now() - this.cache.fetchedAt > CACHE_TTL_MS;
    const unknownKid = kid && this.cache && !this.cache.keys.has(kid);
    if (stale || unknownKid) {
      if (!this.fetching) this.fetching = this.fetchKeys().finally(() => { this.fetching = null; });
      this.cache = await this.fetching;
    }
    return this.cache!;
  }

  /** Verify a raw JWT string. Returns decoded claims or throws on failure. */
  async verify(token: string): Promise<JWTClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('malformed JWT');

    const headerRaw = JSON.parse(b64url(parts[0]).toString()) as { kid?: string; alg?: string };
    const payload = JSON.parse(b64url(parts[1]).toString()) as JWTClaims;

    // Claim checks before crypto (cheap)
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) throw new Error('JWT expired');
    if (payload.iss !== this.issuer) throw new Error(`JWT issuer mismatch: ${payload.iss}`);
    if (this.config.clientId) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud ?? ''];
      if (!aud.includes(this.config.clientId) && payload.azp !== this.config.clientId) {
        throw new Error('JWT audience mismatch');
      }
    }

    // Signature
    const cache = await this.getKeys(headerRaw.kid);
    const key = headerRaw.kid ? cache.keys.get(headerRaw.kid) : [...cache.keys.values()][0];
    if (!key) throw new Error(`No key for kid=${headerRaw.kid ?? 'unknown'}`);

    const alg = headerRaw.alg ?? 'RS256';
    const nodeAlg = alg.startsWith('ES') ? alg.replace('ES', 'SHA') : alg.replace('RS', 'SHA').replace('PS', 'SHA');
    const sigInput = Buffer.from(`${parts[0]}.${parts[1]}`);
    const sig = b64url(parts[2]);

    const ok = alg.startsWith('PS')
      ? crypto.verify(nodeAlg, sigInput, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }, sig)
      : crypto.verify(nodeAlg, sigInput, key, sig);

    if (!ok) throw new Error('JWT signature invalid');
    return payload;
  }
}

// Singleton per config string (reuse key cache across requests).
const instances = new Map<string, KeycloakValidator>();
export function getValidator(cfg: KeycloakConfig): KeycloakValidator {
  const k = `${cfg.url}|${cfg.realm}|${cfg.clientId ?? ''}`;
  if (!instances.has(k)) instances.set(k, new KeycloakValidator(cfg));
  return instances.get(k)!;
}

/** Build a KeycloakConfig from env vars (returns null if not configured). */
export function keycloakConfigFromEnv(): KeycloakConfig | null {
  const url = process.env.OFFGRID_KEYCLOAK_URL;
  const realm = process.env.OFFGRID_KEYCLOAK_REALM;
  if (!url || !realm) return null;
  return { url, realm, clientId: process.env.OFFGRID_KEYCLOAK_CLIENT_ID };
}
