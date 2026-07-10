// Test-only stub for `@/auth`. The real module wires NextAuth to the Postgres adapter and can't load
// under `node --test` (it pulls next-auth's Next-bundler-only graph). The viewer authz tests exercise
// the REAL gate logic in `@/lib/authz` (requireAdmin / requireWriter / requireUser) — the thing under
// test — and only need to control the session the gate reads. So `auth()` returns whatever session a
// test set via `__setSession`, which is the single genuine IO boundary (the cookie session lookup).
//
// This keeps the security proof honest: the gate's decision (403 for a viewer write, 200-eligible for
// a viewer read, admin passes) is computed by the real code, not by the stub.
let session = null;

export function __setSession(next) {
  session = next;
}

export async function auth() {
  return session;
}

// The real module also exports these; inert placeholders keep any importer resolvable.
export const handlers = {};
export const signIn = async () => undefined;
export const signOut = async () => undefined;
