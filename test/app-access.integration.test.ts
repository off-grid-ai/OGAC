import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// INTEGRATION test for per-app ACCESS CONTROL — exercises the REAL store (app-access.ts:
// setAppAccessPolicy / resolveAppAccessPolicy over the self-migrating `app_access_policies` table)
// wired to the REAL pure decision (app-access-policy.ts) through the SAME enforceAppAccess seam every
// entry point (run / webhook-trigger / HITL-approve) calls. It proves the exact scenarios the brief
// requires against a live Postgres:
//   • unauthorized role denied at RUN and at (machine) TRIGGER
//   • under-authority approver rejected at HITL APPROVE
//   • authorized run proceeds
//   • default (no policy bound) = least-privilege (owner + admins only)
//
// Skips green if the DB is down. Writes under a dedicated org; cleans up.

const ORG = 'test-int-app-access';
const APP = 'app_int_access_1';
const OWNER = 'owner@corp';

const dbUp = await dbReachable();

test('per-app access control against a real Postgres', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const {
    ensureAppAccessSchema,
    setAppAccessPolicy,
    resolveAppAccessPolicy,
    deleteAppAccessPolicy,
    enforceAppAccess,
    getAppAccessPolicyRow,
  } = await import('@/lib/app-access');
  // A machine (webhook) caller — the exact shape callerFromMachine produces (role 'machine', no
  // department). Constructed inline so this DB test doesn't import the Next-bound caller adapter.
  const callerFromMachine = (actor: { id: string }, orgId: string) => ({
    role: 'machine',
    department: null,
    orgId,
    userId: actor.id,
  });

  await ensureAppAccessSchema();
  t.after(async () => {
    await deleteAppAccessPolicy(APP, ORG);
  });

  const analyst = { role: 'analyst', department: null, orgId: ORG, userId: 'a@corp' };
  const manager = { role: 'manager', department: null, orgId: ORG, userId: 'm@corp' };

  // ── DEFAULT (no policy bound) = least-privilege ──────────────────────────────────────────────
  await deleteAppAccessPolicy(APP, ORG);
  const def = await resolveAppAccessPolicy(APP, ORG, OWNER);
  assert.deepEqual(def.actions, {}, 'unbound consumer resolves to the empty (default) policy');
  const defOwner = await enforceAppAccess({ appId: APP, orgId: ORG, ownerId: OWNER, caller: { role: 'viewer', orgId: ORG, userId: OWNER }, action: 'run' });
  assert.equal(defOwner.allow, true, 'owner runs by default');
  const defAnalyst = await enforceAppAccess({ appId: APP, orgId: ORG, ownerId: OWNER, caller: analyst, action: 'run' });
  assert.equal(defAnalyst.allow, false, 'non-owner non-admin denied by default (least privilege)');

  // ── bind a policy: analyst may run up to amount ≤ 50000; managers approve ≤ 100000 ───────────
  const saved = await setAppAccessPolicy(APP, ORG, OWNER, {
    actions: {
      run: { roles: ['analyst'], attributes: [{ attribute: 'amount', operator: 'lte', value: '50000' }] },
      trigger: { roles: ['machine'] },
      approve: { roles: ['manager', 'admin'] },
    },
    approval: { approverRoles: ['manager'], thresholdAttribute: 'amount', maxThreshold: 100000 },
  });
  assert.equal(saved.ownerId, OWNER);
  const row = await getAppAccessPolicyRow(APP, ORG);
  assert.ok(row, 'policy persisted');
  assert.deepEqual(row!.actions.run!.roles, ['analyst']);

  // ── authorized RUN proceeds ──────────────────────────────────────────────────────────────────
  const okRun = await enforceAppAccess({
    appId: APP, orgId: ORG, ownerId: OWNER, caller: analyst, action: 'run', requestAttrs: { amount: 40000 },
  });
  assert.equal(okRun.allow, true, 'analyst within threshold may run');

  // ── unauthorized role denied at RUN (viewer not on the list) ─────────────────────────────────
  const denyRun = await enforceAppAccess({
    appId: APP, orgId: ORG, ownerId: OWNER, caller: { role: 'viewer', orgId: ORG, userId: 'v@corp' }, action: 'run', requestAttrs: { amount: 10 },
  });
  assert.equal(denyRun.allow, false, 'viewer role denied at run');

  // ABAC bound too: analyst OVER threshold is denied
  const overRun = await enforceAppAccess({
    appId: APP, orgId: ORG, ownerId: OWNER, caller: analyst, action: 'run', requestAttrs: { amount: 90000 },
  });
  assert.equal(overRun.allow, false, 'analyst over amount threshold denied at run (ABAC)');

  // ── unauthorized at (machine) TRIGGER — a webhook whose policy does NOT admit `machine` ──────
  // Rebind trigger to require a role a machine never has, proving a token is denied at ingress.
  await setAppAccessPolicy(APP, ORG, OWNER, {
    actions: { run: { roles: ['analyst'] }, trigger: { roles: ['analyst'] }, approve: { roles: ['manager'] } },
    approval: { approverRoles: ['manager'], thresholdAttribute: 'amount', maxThreshold: 100000 },
  });
  const machine = callerFromMachine({ id: 'webhook:tok1' }, ORG);
  const denyTrigger = await enforceAppAccess({
    appId: APP, orgId: ORG, ownerId: OWNER, caller: machine, action: 'trigger', requestAttrs: {},
  });
  assert.equal(denyTrigger.allow, false, 'machine trigger denied when policy does not admit the machine role');

  // now admit the machine role and confirm the same token IS allowed at trigger
  await setAppAccessPolicy(APP, ORG, OWNER, {
    actions: { run: { roles: ['analyst'] }, trigger: { roles: ['machine'] }, approve: { roles: ['manager'] } },
    approval: { approverRoles: ['manager'], thresholdAttribute: 'amount', maxThreshold: 100000 },
  });
  const okTrigger = await enforceAppAccess({
    appId: APP, orgId: ORG, ownerId: OWNER, caller: machine, action: 'trigger', requestAttrs: {},
  });
  assert.equal(okTrigger.allow, true, 'machine trigger allowed once policy admits the machine role');

  // ── under-authority approver rejected at HITL APPROVE ────────────────────────────────────────
  // manager within authority approves ≤ 100000
  const okApprove = await enforceAppAccess({
    appId: APP, orgId: ORG, ownerId: OWNER, caller: manager, action: 'approve', requestAttrs: { amount: 90000 },
  });
  assert.equal(okApprove.allow, true, 'manager approves within authority');
  // manager OVER authority ceiling is rejected
  const overApprove = await enforceAppAccess({
    appId: APP, orgId: ORG, ownerId: OWNER, caller: manager, action: 'approve', requestAttrs: { amount: 250000 },
  });
  assert.equal(overApprove.allow, false, 'approver above authority ceiling rejected at HITL approve');
  assert.match(overApprove.reason, /exceeds approver authority/);

  // ── delete reverts to default ────────────────────────────────────────────────────────────────
  const removed = await deleteAppAccessPolicy(APP, ORG);
  assert.equal(removed, true);
  const afterDelete = await enforceAppAccess({ appId: APP, orgId: ORG, ownerId: OWNER, caller: analyst, action: 'run', requestAttrs: { amount: 10 } });
  assert.equal(afterDelete.allow, false, 'after delete, non-owner denied (back to least privilege)');
});
