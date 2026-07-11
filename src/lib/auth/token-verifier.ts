import crypto from 'node:crypto';

// The identity-verification seam. Everything that authenticates a *machine* credential
// (Files API, admin API, gateway) depends on this interface — never on Keycloak
// directly — so the IdP is swappable without touching a single consumer.
//
//   SRP  — a verifier does one thing: turn a raw token into a Principal (or null).
//   OCP  — add a new IdP by writing another IdentityVerifier; no consumer changes.
//   LSP  — any verifier is substitutable; consumers only see the interface.
//   ISP  — the interface is a single method; nothing unused is forced on callers.
//   DIP  — consumers import `getTokenVerifier()` (abstraction), not KeycloakVerifier.

export interface Principal {
  /** Stable subject id (Keycloak `sub`). */
  subject: string;
  /** Human email when present (user tokens). */
  email?: string;
  /** OAuth client id for service accounts (`azp`). */
  clientId?: string;
  /** App role resolved from the token's realm/client roles. Built-in (admin/editor/
   *  viewer) or a custom/scoped role name that module-access resolves to module grants. */
  role: string;
  /** Raw Keycloak realm-access roles, verbatim. Authz maps a MACHINE principal's realm roles
   *  (e.g. an explicit console-admin grant) to a console capability — see lib/auth/machine-roles. */
  realmRoles: string[];
  /** Whether this is a machine (service account) or a person. */
  kind: 'service' | 'user';
}

export interface IdentityVerifier {
  readonly id: string;
  /** Validate a raw bearer token. Returns the Principal on success, null otherwise. */
  verify(token: string): Promise<Principal | null>;
}

// ── Keycloak implementation ─────────────────────────────────────────────────────
// Verifies RS256/ES256/PS JWTs against the realm's JWKS (cached, refreshed on unknown
// kid / TTL). No external deps beyond node:crypto.

interface JWK { kid: string; kty: string; use?: string; n?: string; e?: string; x?: string; y?: string; crv?: string }
const CACHE_TTL_MS = 10 * 60 * 1000;

function b64url(s: string): Buffer {
  return Buffer.from(s.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}
function jwkToKey(k: JWK): crypto.KeyObject {
  if (k.kty === 'RSA') return crypto.createPublicKey({ key: { kty: 'RSA', n: k.n, e: k.e }, format: 'jwk' });
  if (k.kty === 'EC') return crypto.createPublicKey({ key: { kty: 'EC', x: k.x, y: k.y, crv: k.crv }, format: 'jwk' });
  throw new Error(`unsupported JWK: ${k.kty}`);
}

// Roles Keycloak assigns to every account that aren't app scopes — ignored when
// looking for a custom/scoped role name.
const KC_DEFAULT_ROLES = new Set([
  'offline_access', 'uma_authorization', 'default-roles-offgrid',
]);

function roleFrom(claims: Record<string, unknown>): Principal['role'] {
  const realm = (claims['realm_access'] as { roles?: string[] } | undefined)?.roles ?? [];
  const resource = Object.values((claims['resource_access'] as Record<string, { roles?: string[] }> | undefined) ?? {})
    .flatMap((r) => r.roles ?? []);
  const all = new Set([...realm, ...resource, typeof claims['role'] === 'string' ? (claims['role'] as string) : '']);
  if (all.has('admin')) return 'admin';
  if (all.has('editor')) return 'editor';
  // A scoped/custom role (e.g. a service token limited to specific modules) — pass its
  // name through so module-access resolves it to the granted module set. Prefer an
  // explicit svc-* scope role, else the first non-default realm role.
  const scoped = realm.find((r) => r.startsWith('svc-') && !KC_DEFAULT_ROLES.has(r))
    ?? realm.find((r) => r !== 'viewer' && !KC_DEFAULT_ROLES.has(r));
  return scoped ?? 'viewer';
}

class KeycloakVerifier implements IdentityVerifier {
  readonly id = 'keycloak';
  private readonly issuer: string;
  // Keycloak stamps `iss` from the request host, so the SAME realm yields different
  // `iss` values depending on how it's reached (127.0.0.1 vs LAN vs public). Since the
  // signing keys are identical, we accept any issuer for this realm from the configured
  // set. Set OFFGRID_KEYCLOAK_ISSUERS (comma-separated) to add hosts (e.g. the LAN IP a
  // service account mints its token from). JWKS is always fetched from the primary issuer.
  private readonly acceptedIssuers: Set<string>;
  private cache: { keys: Map<string, crypto.KeyObject>; at: number } | null = null;
  private fetching: Promise<{ keys: Map<string, crypto.KeyObject>; at: number }> | null = null;

  constructor(url: string, realm: string, private readonly clientId?: string) {
    this.issuer = `${url}/realms/${realm}`;
    const extra = (process.env.OFFGRID_KEYCLOAK_ISSUERS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean)
      .map((u) => (u.includes('/realms/') ? u : `${u.replace(/\/$/, '')}/realms/${realm}`));
    this.acceptedIssuers = new Set([this.issuer, ...extra]);
  }

  private async keys(kid?: string): Promise<Map<string, crypto.KeyObject>> {
    const stale = !this.cache || Date.now() - this.cache.at > CACHE_TTL_MS;
    const unknown = kid && this.cache && !this.cache.keys.has(kid);
    if (stale || unknown) {
      if (!this.fetching) {
        this.fetching = (async () => {
          const r = await fetch(`${this.issuer}/protocol/openid-connect/certs`, { signal: AbortSignal.timeout(5000) });
          if (!r.ok) throw new Error(`JWKS ${r.status}`);
          const { keys } = (await r.json()) as { keys: JWK[] };
          const m = new Map<string, crypto.KeyObject>();
          for (const k of keys) if (k.use === 'sig' || !k.use) { try { m.set(k.kid, jwkToKey(k)); } catch { /* skip */ } }
          return { keys: m, at: Date.now() };
        })().finally(() => { this.fetching = null; });
      }
      this.cache = await this.fetching;
    }
    return this.cache!.keys;
  }

  // eslint-disable-next-line complexity
  async verify(token: string): Promise<Principal | null> {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const header = JSON.parse(b64url(parts[0]).toString()) as { kid?: string; alg?: string };
      const c = JSON.parse(b64url(parts[1]).toString()) as Record<string, unknown>;

      const now = Math.floor(Date.now() / 1000);
      if (typeof c['exp'] === 'number' && c['exp'] < now) return null;
      if (typeof c['iss'] !== 'string' || !this.acceptedIssuers.has(c['iss'])) return null;
      if (this.clientId) {
        const aud = Array.isArray(c['aud']) ? (c['aud'] as string[]) : [String(c['aud'] ?? '')];
        if (!aud.includes(this.clientId) && c['azp'] !== this.clientId) return null;
      }

      const keys = await this.keys(header.kid);
      const key = header.kid ? keys.get(header.kid) : [...keys.values()][0];
      if (!key) return null;
      const alg = header.alg ?? 'RS256';
      const nodeAlg = alg.startsWith('ES') ? alg.replace('ES', 'SHA') : alg.replace('RS', 'SHA').replace('PS', 'SHA');
      const input = Buffer.from(`${parts[0]}.${parts[1]}`);
      const sig = b64url(parts[2]);
      const ok = alg.startsWith('PS')
        ? crypto.verify(nodeAlg, input, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }, sig)
        : crypto.verify(nodeAlg, input, key, sig);
      if (!ok) return null;

      const username = String(c['preferred_username'] ?? '');
      const isService = username.startsWith('service-account-') || (!c['email'] && Boolean(c['azp']));
      const realmRoles = (c['realm_access'] as { roles?: string[] } | undefined)?.roles ?? [];
      return {
        subject: String(c['sub'] ?? ''),
        email: (c['email'] as string) || undefined,
        clientId: (c['azp'] as string) || undefined,
        role: roleFrom(c),
        realmRoles,
        kind: isService ? 'service' : 'user',
      };
    } catch {
      return null;
    }
  }
}

// ── Factory (the single DIP entry point) ────────────────────────────────────────
let instance: IdentityVerifier | null = null;
export function getTokenVerifier(): IdentityVerifier | null {
  const url = process.env.OFFGRID_KEYCLOAK_URL;
  const realm = process.env.OFFGRID_KEYCLOAK_REALM;
  if (!url || !realm) return null;
  if (!instance) instance = new KeycloakVerifier(url, realm, process.env.OFFGRID_KEYCLOAK_CLIENT_ID);
  return instance;
}
