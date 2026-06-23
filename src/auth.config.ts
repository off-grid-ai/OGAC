import type { NextAuthConfig } from 'next-auth';
import type { Provider } from 'next-auth/providers';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import Keycloak from 'next-auth/providers/keycloak';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';

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

const providers: Provider[] = [];
if (googleEnabled) providers.push(Google);
if (microsoftEnabled) {
  providers.push(MicrosoftEntraID({ issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER }));
}
if (keycloakEnabled) {
  providers.push(
    Keycloak({
      clientId: env.AUTH_KEYCLOAK_ID,
      clientSecret: env.AUTH_KEYCLOAK_SECRET,
      issuer: env.AUTH_KEYCLOAK_ISSUER,
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
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = (user as { role?: string }).role ?? 'viewer';
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.role = token.role as string | undefined;
      return session;
    },
  },
} satisfies NextAuthConfig;
