import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for app SHARING — the REAL store (app-sharing.ts: grant persistence on the
// self-migrating `grants` column + listAllMemberships over teams.ts) wired to the REAL pure decision
// through the SAME enforceAppAccessWithSharing seam the run/trigger/approve routes call. Proves the
// brief's exact scenarios against a live Postgres:
//   • creator grants a user → that user can RUN (was denied before);
//   • revoke → denied again;
//   • a manager IN the creator's chain auto-has access (no grant);
//   • a NON-chain user is denied;
//   • the app's owner + admins always allowed (unchanged).
// Skips green when the DB is down. Writes under dedicated org ids; cleans up.

const ORG = 'test-int-app-sharing';
const APP = 'app_int_share_1';
const OWNER = 'creator@corp';

const dbUp = await dbReachable();

test('app sharing (grants + upward hierarchy) against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    ensureAppSharingSchema,
    listAppGrants,
    grantAppAccess,
    revokeAppAccess,
    enforceAppAccessWithSharing,
  } = await import('@/lib/app-sharing');
  const { deleteAppAccessPolicy } = await import('@/lib/app-access');
  const { createTeam, addTeamMember, deleteTeam } = await import('@/lib/teams');

  await ensureAppSharingSchema();

  const createdTeams: string[] = [];
  t.after(async () => {
    await deleteAppAccessPolicy(APP, ORG).catch(() => {});
    for (const id of createdTeams) await deleteTeam(id, ORG).catch(() => {});
  });

  const grantee = { role: 'analyst', department: null, orgId: ORG, userId: 'grantee@corp' };
  const stranger = { role: 'analyst', department: null, orgId: ORG, userId: 'stranger@corp' };

  // ── baseline: no policy, no grant → non-owner denied (least privilege via RBAC layer) ──────────
  await deleteAppAccessPolicy(APP, ORG);
  await grantAppAccess(APP, ORG, OWNER, 'noise@corp', 'viewer'); // create the row, then clear grants
  await revokeAppAccess(APP, ORG, OWNER, 'noise@corp');
  const before = await enforceAppAccessWithSharing({ appId: APP, orgId: ORG, ownerId: OWNER, caller: grantee, action: 'run' });
  assert.equal(before.allow, false, 'un-granted non-owner denied before sharing');

  // owner + admin always allowed
  const ownerRun = await enforceAppAccessWithSharing({ appId: APP, orgId: ORG, ownerId: OWNER, caller: { role: 'viewer', orgId: ORG, userId: OWNER }, action: 'run' });
  assert.equal(ownerRun.allow, true, 'owner always runs');
  const adminEdit = await enforceAppAccessWithSharing({ appId: APP, orgId: ORG, ownerId: OWNER, caller: { role: 'admin', orgId: ORG, userId: 'root@corp' }, action: 'edit' });
  assert.equal(adminEdit.allow, true, 'admin always allowed');

  // ── creator GRANTS the user runner → user can now RUN ──────────────────────────────────────────
  const grants = await grantAppAccess(APP, ORG, OWNER, 'grantee@corp', 'runner');
  assert.deepEqual(grants, [{ userId: 'grantee@corp', role: 'runner' }]);
  const afterGrant = await enforceAppAccessWithSharing({ appId: APP, orgId: ORG, ownerId: OWNER, caller: grantee, action: 'run' });
  assert.equal(afterGrant.allow, true, 'granted user can run');
  assert.match(afterGrant.reason, /grant/);
  // runner cannot edit
  const grantEdit = await enforceAppAccessWithSharing({ appId: APP, orgId: ORG, ownerId: OWNER, caller: grantee, action: 'edit' });
  assert.equal(grantEdit.allow, false, 'runner grant does not permit edit');

  // ── REVOKE → denied again ────────────────────────────────────────────────────────────────────
  await revokeAppAccess(APP, ORG, OWNER, 'grantee@corp');
  assert.deepEqual(await listAppGrants(APP, ORG), []);
  const afterRevoke = await enforceAppAccessWithSharing({ appId: APP, orgId: ORG, ownerId: OWNER, caller: grantee, action: 'run' });
  assert.equal(afterRevoke.allow, false, 'revoked user denied again');

  // ── UPWARD HIERARCHY: build an org chart so boss manages the creator ───────────────────────────
  // T1: lead=boss, member=creator  ⇒ boss is creator's manager.
  const t1 = await createTeam({ name: `share-team-${Date.now()}` }, ORG);
  createdTeams.push(t1.id);
  await addTeamMember(t1.id, 'boss@corp', 'lead', ORG);
  await addTeamMember(t1.id, OWNER, 'member', ORG);

  const boss = { role: 'analyst', department: null, orgId: ORG, userId: 'boss@corp' };
  // boss auto-has access (inherits approver) — can view/run/approve WITHOUT a grant
  const bossRun = await enforceAppAccessWithSharing({ appId: APP, orgId: ORG, ownerId: OWNER, caller: boss, action: 'run' });
  assert.equal(bossRun.allow, true, 'manager in chain auto-has access');
  assert.match(bossRun.reason, /hierarchy/);
  const bossApprove = await enforceAppAccessWithSharing({ appId: APP, orgId: ORG, ownerId: OWNER, caller: boss, action: 'approve' });
  assert.equal(bossApprove.allow, true, 'manager inherits approve');
  // but not edit (hierarchy inherits approver, not editor)
  const bossEdit = await enforceAppAccessWithSharing({ appId: APP, orgId: ORG, ownerId: OWNER, caller: boss, action: 'edit' });
  assert.equal(bossEdit.allow, false, 'manager cannot edit via hierarchy');

  // ── NON-chain user still denied ────────────────────────────────────────────────────────────────
  const strangerRun = await enforceAppAccessWithSharing({ appId: APP, orgId: ORG, ownerId: OWNER, caller: stranger, action: 'run' });
  assert.equal(strangerRun.allow, false, 'non-chain, un-granted user denied');
});
