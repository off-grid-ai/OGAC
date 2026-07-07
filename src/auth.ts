import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';
import { db } from '@/db';
import { accounts, sessions, users, verificationTokens } from '@/db/schema';
import { getUserOrgByEmail } from '@/lib/store';

// Full auth instance (Node runtime) — adds the Postgres adapter to the edge-safe config.
// Used by the route handler and server components/actions. JWT sessions so the edge
// middleware can authorize without a DB round-trip.
//
// TENANT MEMBERSHIP: the org a user belongs to is a DB lookup (users.org_id), so it must resolve in
// the NODE runtime — NOT in auth.config.ts, which the edge middleware imports (a pg import there
// breaks the edge bundle). So we wrap the edge-safe jwt/session callbacks here: run the base one
// (role), then stamp token.org from the DB and mirror it onto the session. currentOrgId then uses
// session.user.org as the membership source for tenant/subdomain scoping.
const baseJwt = authConfig.callbacks?.jwt;
const baseSession = authConfig.callbacks?.session;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'jwt' },
  callbacks: {
    ...authConfig.callbacks,
    async jwt(params) {
      const token = baseJwt ? await baseJwt(params) : params.token;
      const email = typeof token.email === 'string' ? token.email : '';
      // Resolve org on sign-in (user present) or if not yet stamped; keep it cached on the token
      // otherwise so we don't hit the DB on every request.
      if (email && (params.user || !token.org)) {
        try {
          const org = await getUserOrgByEmail(email);
          if (org) token.org = org;
        } catch {
          /* DB unreachable — leave org unset; currentOrgId falls back to the default org */
        }
      }
      return token;
    },
    session(params) {
      const session = baseSession ? baseSession(params) : params.session;
      if (session.user) session.user.org = params.token.org as string | undefined;
      return session;
    },
  },
});
