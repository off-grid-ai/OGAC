// Identity abstraction — the seam that owns "verify a username + password".
//
// The console renders its OWN login form and authenticates through this interface,
// so users never see the underlying IdP's hosted page. Keycloak is today's
// implementation (via OIDC Direct Access Grant / ROPC), but the rest of the app
// depends only on `authenticatePassword` — swap the provider here later without
// touching the UI or NextAuth wiring. No user-facing reference to Keycloak lives
// outside this file.

export interface AppUser {
  id: string;
  email?: string;
  name?: string;
  role: string;
  // The caller's tenant organisation, read from the access-token claims. Drives tenant-org binding
  // (tenancy-policy `bindTenantOrg`): a viewer whose token claims org=org_bharat binds to the
  // bharatunion tenant's data on that subdomain (tenantOrg === actorOrg). Undefined when the token
  // carries no org claim, in which case the caller falls back to the default org.
  org?: string;
}

export interface IdentityProvider {
  readonly id: string;
  authenticate(username: string, password: string): Promise<AppUser | null>;
}

// Decode a JWT payload (base64url) without verifying — we only trust it because it
// came straight from the token endpoint over the trusted channel; it's used purely
// to read the caller's identity + role claims.
function claims(jwt: string): Record<string, unknown> {
  try {
    const part = jwt.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function roleFrom(p: Record<string, unknown>): string {
  if (typeof p['role'] === 'string') return p['role'];
  const realm = (p['realm_access'] as { roles?: string[] } | undefined)?.roles ?? [];
  const resource = Object.values((p['resource_access'] as Record<string, { roles?: string[] }> | undefined) ?? {}).flatMap(
    (r) => r.roles ?? [],
  );
  const all = [...realm, ...resource];
  return all.includes('admin') ? 'admin' : all.includes('editor') ? 'editor' : 'viewer';
}

// Read the caller's tenant org from the access-token claims. First non-empty of, in order:
//   1. a top-level `org` claim (the canonical mapper output),
//   2. an `organization` claim (alternative single-value mapper),
//   3. the first entry of an `organization` GROUP claim (an array, e.g. Keycloak group membership).
// Returns undefined when none is present, so the caller falls back to the default org (no binding).
// Pure — a decoded payload in, the org string (or undefined) out; unit-testable in isolation.
export function orgFrom(p: Record<string, unknown>): string | undefined {
  const org = p['org'];
  if (typeof org === 'string' && org.trim()) return org.trim();
  const organization = p['organization'];
  if (typeof organization === 'string' && organization.trim()) return organization.trim();
  if (Array.isArray(organization)) {
    const first = organization.find((v) => typeof v === 'string' && v.trim());
    if (typeof first === 'string') return first.trim();
  }
  return undefined;
}

// Keycloak implementation via Direct Access Grant (ROPC): POST the credentials to the
// realm token endpoint; on success read identity + role from the access token.
const keycloakIdentity: IdentityProvider = {
  id: 'keycloak',
  // eslint-disable-next-line complexity
  async authenticate(username, password) {
    const issuer = process.env.AUTH_KEYCLOAK_ISSUER;
    const clientId = process.env.AUTH_KEYCLOAK_ID;
    const clientSecret = process.env.AUTH_KEYCLOAK_SECRET;
    if (!issuer || !clientId || !clientSecret || !username || !password) return null;
    try {
      const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: clientId,
          client_secret: clientSecret,
          username,
          password,
          scope: 'openid',
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const tok = (await res.json()) as { access_token?: string };
      if (!tok.access_token) return null;
      const p = claims(tok.access_token);
      return {
        id: String(p['sub'] ?? username),
        email: (p['email'] as string) ?? (p['preferred_username'] as string) ?? username,
        name: (p['name'] as string) ?? (p['preferred_username'] as string) ?? username,
        role: roleFrom(p),
        org: orgFrom(p),
      };
    } catch {
      return null;
    }
  },
};

// The active identity provider — the single swap point.
export const identity: IdentityProvider = keycloakIdentity;

export async function authenticatePassword(username: string, password: string): Promise<AppUser | null> {
  return identity.authenticate(username, password);
}
