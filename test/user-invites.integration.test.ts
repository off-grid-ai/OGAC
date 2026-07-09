import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for USER INVITES against a REAL Postgres. Proves the full lifecycle through the
// real store (self-migrating user_invites table + token-hash-at-rest) with the Keycloak + Resend
// boundaries STUBBED (injected) — those are external services, everything else is exercised for real:
//   • create → token stored HASHED (never plaintext), invite pending;
//   • accept with the plaintext token → provisions (stub) + applies the app grant (stub) + marks the
//     invite accepted (single-use);
//   • the SAME token replayed → rejected (already accepted);
//   • an EXPIRED invite → rejected + lazily flipped to 'expired';
//   • a REVOKED invite → rejected;
//   • an UNKNOWN token → 404;
//   • org-scoping: a list is scoped to its org.
// Skips green when the DB is down.

const ORG = 'test-int-user-invites';
const OTHER_ORG = 'test-int-user-invites-other';

const dbUp = await dbReachable();

test('user invite lifecycle against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const store = await import('../src/lib/user-invites.ts');
  const { hashInviteToken } = await import('../src/lib/user-invites-policy.ts');
  const { db } = await import('../src/db/index.ts');
  const { sql } = await import('drizzle-orm');

  await store.ensureUserInvitesSchema();

  const created: string[] = [];
  t.after(async () => {
    await db.execute(sql`DELETE FROM user_invites WHERE org_id IN (${ORG}, ${OTHER_ORG});`);
  });

  // ── CREATE — token hashed at rest ──────────────────────────────────────────────────────────────
  const { invite, token } = await store.createInvite({
    orgId: ORG,
    email: 'invitee@corp.com',
    role: 'viewer',
    appGrants: [{ appId: 'app_int_1', appRole: 'runner' }],
    invitedBy: 'admin@corp.com',
  });
  created.push(invite.id);
  assert.equal(invite.status, 'pending');
  assert.equal(invite.email, 'invitee@corp.com');
  assert.deepEqual(invite.appGrants, [{ appId: 'app_int_1', appRole: 'runner' }]);
  assert.ok(token.length > 20, 'a real opaque token is returned');

  // the DB stores the HASH, not the plaintext
  const rawRows = await db.execute(
    sql`SELECT token_hash FROM user_invites WHERE id = ${invite.id};`,
  );
  const storedHash = (rawRows.rows as { token_hash: string }[])[0]?.token_hash;
  assert.equal(storedHash, hashInviteToken(token), 'stored token_hash is sha256(token)');
  assert.notEqual(storedHash, token, 'plaintext token is never persisted');

  // ── ACCEPT — stubbed provisioning + grant application, real state transition ─────────────────────
  let provisionedFor = '';
  const appliedGrants: string[] = [];
  const accept = await store.acceptInvite(token, {
    provision: async (inv) => {
      provisionedFor = inv.email;
      return { provisioned: true, keycloakUserId: 'kc-user-1' };
    },
    applyGrant: async (inv, grant) => {
      appliedGrants.push(`${grant.appId}:${grant.appRole}:${inv.email}`);
    },
  });
  assert.equal(accept.ok, true);
  assert.equal(accept.status, 200);
  assert.equal(accept.provisioned, true);
  assert.equal(accept.keycloakUserId, 'kc-user-1');
  assert.equal(provisionedFor, 'invitee@corp.com', 'Keycloak provisioning seam was called');
  assert.deepEqual(appliedGrants, ['app_int_1:runner:invitee@corp.com'], 'app grant applied via seam');

  const afterAccept = await store.getInviteById(invite.id, ORG);
  assert.equal(afterAccept?.status, 'accepted');
  assert.ok(afterAccept?.acceptedAt, 'accepted_at is stamped');

  // ── REPLAY — the same single-use token is now rejected ───────────────────────────────────────────
  const replay = await store.acceptInvite(token, { provision: async () => ({ provisioned: true }) });
  assert.equal(replay.ok, false);
  assert.equal(replay.status, 410);
  assert.match(replay.reason, /already been accepted/);

  // ── EXPIRED — accepting a past-expiry invite is rejected + lazily flipped to 'expired' ────────────
  const expiring = await store.createInvite({
    orgId: ORG,
    email: 'late@corp.com',
    role: 'viewer',
    appGrants: [],
    invitedBy: 'admin@corp.com',
    ttlDays: 7,
    now: new Date(Date.now() - 30 * 86400_000), // created 30 days ago → already expired
  });
  created.push(expiring.invite.id);
  const expiredAccept = await store.acceptInvite(expiring.token, {
    provision: async () => ({ provisioned: true }),
  });
  assert.equal(expiredAccept.ok, false);
  assert.equal(expiredAccept.status, 410);
  assert.match(expiredAccept.reason, /expired/);
  const expiredRow = await store.getInviteById(expiring.invite.id, ORG);
  assert.equal(expiredRow?.status, 'expired', 'expiry was persisted on read');

  // ── REVOKED — a revoked invite cannot be accepted ────────────────────────────────────────────────
  const toRevoke = await store.createInvite({
    orgId: ORG,
    email: 'revoked@corp.com',
    role: 'viewer',
    appGrants: [],
    invitedBy: 'admin@corp.com',
  });
  created.push(toRevoke.invite.id);
  const revoked = await store.revokeInvite(toRevoke.invite.id, ORG);
  assert.equal(revoked?.status, 'revoked');
  const revokedAccept = await store.acceptInvite(toRevoke.token, {
    provision: async () => ({ provisioned: true }),
  });
  assert.equal(revokedAccept.ok, false);
  assert.equal(revokedAccept.status, 410);
  assert.match(revokedAccept.reason, /revoked/);

  // ── UNKNOWN token → 404 ──────────────────────────────────────────────────────────────────────────
  const unknown = await store.acceptInvite('this-is-not-a-real-token', {
    provision: async () => ({ provisioned: true }),
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.status, 404);

  // ── ORG SCOPING — a list is scoped to its org ────────────────────────────────────────────────────
  const other = await store.createInvite({
    orgId: OTHER_ORG,
    email: 'elsewhere@corp.com',
    role: 'viewer',
    appGrants: [],
    invitedBy: 'admin@corp.com',
  });
  created.push(other.invite.id);
  const orgList = await store.listInvites(ORG);
  assert.ok(orgList.every((i) => i.orgId === ORG), 'list is org-scoped');
  assert.ok(!orgList.some((i) => i.email === 'elsewhere@corp.com'), 'other org invite not leaked');
  // and the other org sees its own
  const otherList = await store.listInvites(OTHER_ORG);
  assert.ok(otherList.some((i) => i.email === 'elsewhere@corp.com'));

  // ── DELETE ─────────────────────────────────────────────────────────────────────────────────────
  assert.equal(await store.deleteInvite(other.invite.id, OTHER_ORG), true);
  assert.equal(await store.getInviteById(other.invite.id, OTHER_ORG), null);
});

// A SECOND test: accept when Keycloak is NOT configured still consumes the invite honestly.
test('accept with no Keycloak configured consumes the invite but reports not-provisioned', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const store = await import('../src/lib/user-invites.ts');
  const { db } = await import('../src/db/index.ts');
  const { sql } = await import('drizzle-orm');
  await store.ensureUserInvitesSchema();
  t.after(async () => {
    await db.execute(sql`DELETE FROM user_invites WHERE org_id = ${ORG};`);
  });

  const { invite, token } = await store.createInvite({
    orgId: ORG,
    email: 'nokc@corp.com',
    role: 'viewer',
    appGrants: [],
    invitedBy: 'admin@corp.com',
  });

  // Use the DEFAULT provision path (real provisionInviteUser). With no OFFGRID_KEYCLOAK_* env in the
  // test process, keycloakAdmin() returns null → provisioned:false, but the invite is still consumed.
  const res = await store.acceptInvite(token);
  assert.equal(res.ok, true, 'accept still succeeds so the token cannot be reused');
  assert.equal(res.provisioned, false, 'honestly reports the user was not provisioned');
  const after = await store.getInviteById(invite.id, ORG);
  assert.equal(after?.status, 'accepted', 'invite consumed regardless');
});
