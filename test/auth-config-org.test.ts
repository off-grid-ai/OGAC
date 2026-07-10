import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authConfig } from '@/auth.config';

// Exercises the REAL jwt + session NextAuth callbacks (no mocks) to prove per-user org propagation
// through login. This is security-adjacent: a wrong org would bind a viewer to the wrong tenant, so
// the corners — org present/absent, the founder-admin escape hatch, refresh preservation, OIDC
// mapping — are each their own scenario. The terminal artifact asserted is the token/session the rest
// of the app consumes (token.org feeds session.user.org feeds bindTenantOrg's actorOrg).

const jwt = authConfig.callbacks!.jwt!;
const session = authConfig.callbacks!.session!;

// Minimal typed shims for the callback args (NextAuth's unions are wide; we drive the paths we own).
type JwtArgs = Parameters<typeof jwt>[0];
type SessionArgs = Parameters<typeof session>[0];

const runJwt = (args: Partial<JwtArgs>) =>
  jwt({ token: {}, ...args } as JwtArgs) as Promise<Record<string, unknown>> | Record<string, unknown>;

test('jwt (password/credentials path): a user with org sets token.org and token.role', async () => {
  const token = await runJwt({ user: { id: 'v1', role: 'viewer', org: 'org_bharat' } as never });
  assert.equal(token.org, 'org_bharat');
  assert.equal(token.role, 'viewer');
});

test('jwt (password path): a user without org leaves token.org undefined', async () => {
  const token = await runJwt({ user: { id: 'v1', role: 'viewer' } as never });
  assert.equal(token.org, undefined);
  assert.equal(token.role, 'viewer');
});

test('jwt (refresh): token.org is preserved when a later call carries no user org', async () => {
  // On a refresh NextAuth re-invokes jwt with the existing token and a user that may lack org.
  const token = await runJwt({
    token: { org: 'org_suraksha', role: 'viewer' } as never,
    user: { id: 'v1', role: 'viewer' } as never,
  });
  assert.equal(token.org, 'org_suraksha');
});

test('jwt (admin escape hatch): an OFFGRID_ADMIN_EMAILS user is forced to admin, org still set', async () => {
  const saved = process.env.OFFGRID_ADMIN_EMAILS;
  try {
    process.env.OFFGRID_ADMIN_EMAILS = 'founder@offgrid.local';
    const token = await runJwt({
      token: { email: 'founder@offgrid.local' } as never,
      user: { id: 'f1', role: 'viewer', org: 'org_bharat' } as never,
    });
    assert.equal(token.role, 'admin', 'escape hatch forces admin regardless of resolved role');
    assert.equal(token.org, 'org_bharat', 'org still propagates for the admin');
  } finally {
    if (saved === undefined) delete process.env.OFFGRID_ADMIN_EMAILS;
    else process.env.OFFGRID_ADMIN_EMAILS = saved;
  }
});

test('jwt (keycloak-oidc branch): org is read from a top-level `org` profile claim', async () => {
  const token = await runJwt({
    account: { provider: 'keycloak' } as never,
    profile: { org: 'org_bharat', realm_access: { roles: ['viewer'] } } as never,
  });
  assert.equal(token.org, 'org_bharat');
  assert.equal(token.role, 'viewer');
});

test('jwt (keycloak-oidc branch): org falls back to the `organization` group array', async () => {
  const token = await runJwt({
    account: { provider: 'keycloak' } as never,
    profile: { organization: ['org_suraksha'], role: 'editor' } as never,
  });
  assert.equal(token.org, 'org_suraksha');
  assert.equal(token.role, 'editor');
});

test('jwt (keycloak-oidc branch): no org claim leaves token.org untouched', async () => {
  const token = await runJwt({
    account: { provider: 'keycloak' } as never,
    profile: { realm_access: { roles: ['viewer'] } } as never,
  });
  assert.equal(token.org, undefined);
});

test('session: token.org is copied onto session.user.org (feeds bindTenantOrg actorOrg)', () => {
  const out = session({
    session: { user: { name: 'V', email: 'v@x.io' } },
    token: { role: 'viewer', org: 'org_bharat' },
  } as unknown as SessionArgs);
  assert.equal(out.user!.org, 'org_bharat');
  assert.equal(out.user!.role, 'viewer');
});

test('session: an absent token.org yields session.user.org undefined (no binding)', () => {
  const out = session({
    session: { user: { name: 'V', email: 'v@x.io' } },
    token: { role: 'viewer' },
  } as unknown as SessionArgs);
  assert.equal(out.user!.org, undefined);
});
