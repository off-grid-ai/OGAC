// Identity abstraction — the seam that owns "verify a username + password".
//
// The console renders its OWN login form and authenticates through this interface,
// so users never see the underlying IdP's hosted page. Keycloak is today's
// implementation (via OIDC Direct Access Grant / ROPC), but the rest of the app
// depends only on `authenticatePassword` — swap the provider here later without
// touching the UI or NextAuth wiring. No user-facing reference to Keycloak lives
// outside this file.

import { orgFromClaims } from './org-claim';
// Re-exported so the identity seam stays the one import surface for the ROPC path (and its test).
export { orgFromClaims as orgFrom } from './org-claim';

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
        org: orgFromClaims(p),
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
