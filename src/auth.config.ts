import type { NextAuthConfig } from 'next-auth';
import type { Provider } from 'next-auth/providers';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import Keycloak from 'next-auth/providers/keycloak';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
// Pure, zero-IO org-claim reader — safe in the Edge-shared config (single source of truth, DRY with
// the identity ROPC path). The OIDC branch below maps org from the token; the ROPC/password path (in
// production) resolves it on the AppUser via the same reader.
import { orgFromClaims } from '@/lib/auth/org-claim';

// Each SSO provider self-activates only when its credentials are present in env — an
// unconfigured provider would otherwise crash the whole auth handler. See .env.example.
const env = process.env;

export const googleEnabled = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
export const microsoftEnabled = Boolean(
  env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
  env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
);
// Keycloak (self-hosted IAM / OIDC) — the identity adapter's OSS swap-in. Self-activates when
// its OIDC client env is present; ISSUER is the realm URL, e.g. http://127.0.0.1:8080/realms/offgrid.
export const keycloakEnabled = Boolean(
  env.AUTH_KEYCLOAK_ID && env.AUTH_KEYCLOAK_SECRET && env.AUTH_KEYCLOAK_ISSUER,
);
// Dev-only login so the console is browsable without OAuth. NEVER on in production.
export const devLoginEnabled = env.AUTH_DEV_LOGIN === 'true' && env.NODE_ENV !== 'production';
// Console-owned username/password login — authenticates through the identity seam
// (Keycloak ROPC today) so the console renders its OWN form, no redirect to a hosted
// IdP page. Available whenever the identity backend (Keycloak) is configured.
export const passwordEnabled = keycloakEnabled;

const providers: Provider[] = [];
if (googleEnabled) providers.push(Google);
if (microsoftEnabled) {
  providers.push(MicrosoftEntraID({ issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER }));
}
// NOTE: the Keycloak OIDC provider is intentionally NOT registered — it would send
// users to Keycloak's hosted login page (and leak the internal issuer URL). We own
// the login UI and authenticate against Keycloak server-side via the `password`
// (ROPC) provider below. `Keycloak` import kept for the swap-back option only.
void Keycloak;
if (passwordEnabled) {
  providers.push(
    Credentials({
      id: 'password',
      name: 'Off Grid AI',
      credentials: {
        username: { label: 'Email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (creds) => {
        const { authenticatePassword } = await import('@/lib/auth/identity');
        return authenticatePassword(String(creds?.username ?? ''), String(creds?.password ?? ''));
      },
    }),
  );
}
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: 'dev',
      name: 'Dev login',
      credentials: {},
      authorize: () => ({
        id: 'dev-admin',
        email: 'dev@offgrid.local',
        name: 'Dev Admin',
        role: 'admin',
      }),
    }),
  );
}

// Edge-safe config (no DB adapter) — shared by the middleware and the full auth instance.
export const authConfig = {
  trustHost: true,
  providers,
  pages: { signIn: '/signin' },
  // Session cookie. The NAME is FIXED (not conditional) so the Node auth handler
  // that SETS it and the Edge middleware that READS it always agree — a name that
  // depended on an env var that resolves differently across runtimes caused a
  // sign-in loop. A custom name also sidesteps any stale `authjs`-named cookie left
  // over from a secret rotation. `domain` is added only when AUTH_COOKIE_DOMAIN is
  // set, so ONE login is shared across *.getoffgridai.co for the Caddy gate.
  cookies: {
    sessionToken: {
      name: env.NODE_ENV === 'production' ? '__Secure-offgrid.session' : 'offgrid.session',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: env.NODE_ENV === 'production',
        ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
      },
    },
  },
  callbacks: {
    // Allow post-login redirects back to gated sibling *.getoffgridai.co surfaces.
    // — the gated services sign in via the console, so their callbackUrl is a sibling subdomain.
    // NextAuth's default rejects cross-origin callbacks, which stranded users on the console.
    redirect({ url, baseUrl }) {
      try {
        const u = new URL(url, baseUrl);
        if (u.origin === baseUrl || /(^|\.)getoffgridai\.co$/i.test(u.hostname))
          return u.toString();
      } catch {
        /* fall through */
      }
      return baseUrl;
    },
    // eslint-disable-next-line complexity
    jwt({ token, user, account, profile }) {
      // Keycloak: roles come in the token as realm_access.roles or a custom `role` claim.
      // We map the first recognised app role (admin > editor > viewer) to our internal role.
      if (account?.provider === 'keycloak' && profile) {
        const kc = profile as Record<string, unknown>;
        const realmRoles: string[] =
          (kc['realm_access'] as { roles?: string[] } | undefined)?.roles ?? [];
        const resourceRoles: string[] = Object.values(
          (kc['resource_access'] as Record<string, { roles?: string[] }> | undefined) ?? {},
        ).flatMap((r) => r.roles ?? []);
        const all = [...realmRoles, ...resourceRoles];
        // Also accept a top-level `role` claim if set in Keycloak's token mapper.
        const direct = typeof kc['role'] === 'string' ? kc['role'] : null;
        token.role =
          direct ??
          (all.includes('admin') ? 'admin' : all.includes('editor') ? 'editor' : 'viewer');
        // Carry the tenant org if the OIDC token maps it (harmless, future-proof — the ROPC/password
        // path below is the one in use today). Same claim shapes as identity's orgFrom.
        const oidcOrg = orgFromClaims(kc);
        if (oidcOrg) token.org = oidcOrg;
      } else if (user) {
        // Non-Keycloak sign-in (dev credentials, Google, Microsoft) and the console-owned
        // password/ROPC path: use the role + org the identity seam resolved onto the AppUser.
        // Preserve an already-bound token.org across refreshes when this call carries none.
        token.role = (user as { role?: string }).role ?? 'viewer';
        token.org = (user as { org?: string }).org ?? token.org;
      }
      // Founder/bootstrap escape hatch — applies to EVERY provider and every token
      // refresh: any email in OFFGRID_ADMIN_EMAILS is always admin. Solves the
      // chicken-and-egg where role management is itself admin-gated. Uses token.email
      // (NextAuth-populated) plus the raw profile email, so it works regardless of
      // which login path set the role above.
      const adminEmails = (process.env.OFFGRID_ADMIN_EMAILS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const profileEmail =
        profile && typeof (profile as Record<string, unknown>)['email'] === 'string'
          ? ((profile as Record<string, unknown>)['email'] as string)
          : '';
      const email = (
        profileEmail ||
        (typeof token.email === 'string' ? token.email : '') ||
        ''
      ).toLowerCase();
      if (email && adminEmails.includes(email)) token.role = 'admin';
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string | undefined;
        // Propagate the tenant org so tenancy binding (bindTenantOrg) sees actorOrg on this session.
        session.user.org = token.org as string | undefined;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
