import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth from 'next-auth';
import { authConfig } from '@/auth.config';
import { db } from '@/db';
import { accounts, sessions, users, verificationTokens } from '@/db/schema';

// Full auth instance (Node runtime) — adds the Postgres adapter to the edge-safe config.
// Used by the route handler and server components/actions. JWT sessions so the edge
// middleware can authorize without a DB round-trip.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'jwt' },
});
