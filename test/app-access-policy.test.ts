import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APP_ACTIONS,
  ABAC_OPERATORS,
  defaultAppAccessPolicy,
  evaluateAppAccess,
  evaluateApprovalAuthority,
  evaluatePredicate,
  validateAppAccessPolicyInput,
  type AppAccessCaller,
  type AppAccessPolicy,
} from '../src/lib/app-access-policy.ts';

// Pure per-app access-control decision. Zero-IO — every RBAC / ABAC / approval-authority branch is
// exercised here without a DB, per the SOLID coverage bar.

const ORG = 'org-a';
function caller(p: Partial<AppAccessCaller>): AppAccessCaller {
  return { role: 'analyst', department: null, orgId: ORG, userId: 'u@corp', ...p };
}
function policy(p: Partial<AppAccessPolicy>): AppAccessPolicy {
  return { appId: 'app_1', orgId: ORG, ownerId: 'owner@corp', actions: {}, ...p };
}

// ─── predicate evaluation ──────────────────────────────────────────────────────────────────────────
test('evaluatePredicate: string operators', () => {
  assert.equal(evaluatePredicate({ attribute: 'region', operator: 'eq', value: 'IN' }, { region: 'IN' }), true);
  assert.equal(evaluatePredicate({ attribute: 'region', operator: 'eq', value: 'IN' }, { region: 'US' }), false);
  assert.equal(evaluatePredicate({ attribute: 'region', operator: 'neq', value: 'US' }, { region: 'IN' }), true);
  assert.equal(evaluatePredicate({ attribute: 'region', operator: 'neq', value: 'IN' }, { region: 'IN' }), false);
  assert.equal(evaluatePredicate({ attribute: 'r', operator: 'in', value: 'IN, US' }, { r: 'US' }), true);
  assert.equal(evaluatePredicate({ attribute: 'r', operator: 'in', value: 'IN, US' }, { r: 'UK' }), false);
  assert.equal(evaluatePredicate({ attribute: 'name', operator: 'contains', value: 'foo' }, { name: 'a-foo-b' }), true);
  assert.equal(evaluatePredicate({ attribute: 'name', operator: 'contains', value: 'zzz' }, { name: 'abc' }), false);
});

test('evaluatePredicate: numeric comparators + fail-closed on missing/NaN', () => {
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'lte', value: '100' }, { amount: 100 }), true);
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'lte', value: '100' }, { amount: 101 }), false);
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'lt', value: '100' }, { amount: 99 }), true);
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'lt', value: '100' }, { amount: 100 }), false);
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'gt', value: '100' }, { amount: 101 }), true);
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'gt', value: '100' }, { amount: 100 }), false);
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'gte', value: '100' }, { amount: 100 }), true);
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'gte', value: '100' }, { amount: 99 }), false);
  // string-coerced numbers work
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'lte', value: '100' }, { amount: '50' }), true);
  // missing attribute → false (fail-closed)
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'lte', value: '100' }, {}), false);
  // non-numeric value → false
  assert.equal(evaluatePredicate({ attribute: 'amount', operator: 'lte', value: 'abc' }, { amount: 5 }), false);
  // eq/neq with missing attribute → false
  assert.equal(evaluatePredicate({ attribute: 'x', operator: 'eq', value: 'y' }, {}), false);
  assert.equal(evaluatePredicate({ attribute: 'x', operator: 'neq', value: 'y' }, {}), false);
  // unknown operator → false
  assert.equal(
    evaluatePredicate({ attribute: 'x', operator: 'bogus' as never, value: 'y' }, { x: 'y' }),
    false,
  );
});

// ─── RBAC ────────────────────────────────────────────────────────────────────────────────────────
test('RBAC: admin always allowed; owner always allowed', () => {
  const p = policy({ actions: {} });
  assert.equal(evaluateAppAccess(p, caller({ role: 'admin' }), 'run').allow, true);
  assert.equal(evaluateAppAccess(p, caller({ userId: 'owner@corp', role: 'viewer' }), 'edit').allow, true);
});

test('RBAC: least-privilege default denies a non-owner non-admin', () => {
  const p = defaultAppAccessPolicy('app_1', ORG, 'owner@corp');
  const d = evaluateAppAccess(p, caller({ role: 'analyst' }), 'run');
  assert.equal(d.allow, false);
  assert.match(d.reason, /not permitted to run/);
});

test('RBAC: role allow-list + wildcard', () => {
  const p = policy({ actions: { run: { roles: ['analyst'] } } });
  assert.equal(evaluateAppAccess(p, caller({ role: 'analyst' }), 'run').allow, true);
  assert.equal(evaluateAppAccess(p, caller({ role: 'viewer' }), 'run').allow, false);
  const star = policy({ actions: { run: { roles: ['*'] } } });
  assert.equal(evaluateAppAccess(star, caller({ role: 'anyone' }), 'run').allow, true);
  // undefined role denied unless wildcard
  const p2 = policy({ actions: { run: { roles: ['analyst'] } } });
  assert.equal(evaluateAppAccess(p2, caller({ role: undefined }), 'run').allow, false);
});

test('RBAC: department allow-list', () => {
  const p = policy({ actions: { run: { roles: [], departments: ['Finance'] } } });
  assert.equal(evaluateAppAccess(p, caller({ role: 'x', department: 'Finance' }), 'run').allow, true);
  assert.equal(evaluateAppAccess(p, caller({ role: 'x', department: 'Risk' }), 'run').allow, false);
  assert.equal(evaluateAppAccess(p, caller({ role: 'x', department: null }), 'run').allow, false);
});

// ─── ABAC ────────────────────────────────────────────────────────────────────────────────────────
test('ABAC: attribute predicates gate an otherwise-allowed role', () => {
  const p = policy({
    actions: { run: { roles: ['analyst'], attributes: [{ attribute: 'amount', operator: 'lte', value: '50000' }] } },
  });
  assert.equal(evaluateAppAccess(p, caller({ role: 'analyst' }), 'run', { amount: 40000 }).allow, true);
  const d = evaluateAppAccess(p, caller({ role: 'analyst' }), 'run', { amount: 60000 });
  assert.equal(d.allow, false);
  assert.match(d.reason, /do not satisfy the run constraints/);
  // missing attribute fails closed
  assert.equal(evaluateAppAccess(p, caller({ role: 'analyst' }), 'run', {}).allow, false);
});

test('ABAC: admin bypasses attribute constraints', () => {
  const p = policy({
    actions: { run: { roles: ['analyst'], attributes: [{ attribute: 'amount', operator: 'lte', value: '1' }] } },
  });
  assert.equal(evaluateAppAccess(p, caller({ role: 'admin' }), 'run', { amount: 999 }).allow, true);
});

// ─── org boundary ──────────────────────────────────────────────────────────────────────────────────
test('cross-org caller is denied outright', () => {
  const p = policy({ actions: { run: { roles: ['*'] } } });
  const d = evaluateAppAccess(p, caller({ orgId: 'other-org', role: 'admin' }), 'run');
  assert.equal(d.allow, false);
  assert.match(d.reason, /does not match policy org/);
});

// ─── approval authority ─────────────────────────────────────────────────────────────────────────────
test('approval authority: no constraint allows any approver who passed RBAC', () => {
  assert.equal(evaluateApprovalAuthority(undefined, caller({}), {}).allow, true);
});

test('approval authority: approver role / user gates', () => {
  const auth = { approverRoles: ['manager'], approverUsers: ['cfo@corp'] };
  assert.equal(evaluateApprovalAuthority(auth, caller({ role: 'manager' }), {}).allow, true);
  assert.equal(evaluateApprovalAuthority(auth, caller({ role: 'x', userId: 'cfo@corp' }), {}).allow, true);
  const d = evaluateApprovalAuthority(auth, caller({ role: 'analyst', userId: 'u@corp' }), {});
  assert.equal(d.allow, false);
  assert.match(d.reason, /not an authorized approver/);
});

test('approval authority: threshold ceiling', () => {
  const auth = { approverRoles: ['manager'], thresholdAttribute: 'amount', maxThreshold: 50000 };
  assert.equal(evaluateApprovalAuthority(auth, caller({ role: 'manager' }), { amount: 50000 }).allow, true);
  const over = evaluateApprovalAuthority(auth, caller({ role: 'manager' }), { amount: 50001 });
  assert.equal(over.allow, false);
  assert.match(over.reason, /exceeds approver authority/);
  // non-numeric threshold value → rejected
  const nan = evaluateApprovalAuthority(auth, caller({ role: 'manager' }), { amount: 'x' });
  assert.equal(nan.allow, false);
  assert.match(nan.reason, /numeric amount/);
  // threshold attribute set but maxThreshold undefined → no threshold check
  const noMax = evaluateApprovalAuthority(
    { approverRoles: ['manager'], thresholdAttribute: 'amount' },
    caller({ role: 'manager' }),
    { amount: 9e9 },
  );
  assert.equal(noMax.allow, true);
});

test('evaluateAppAccess approve: RBAC + approval authority compose; under-authority approver rejected', () => {
  const p = policy({
    actions: { approve: { roles: ['manager', 'admin'] } },
    approval: { approverRoles: ['manager'], thresholdAttribute: 'amount', maxThreshold: 100000 },
  });
  // manager within threshold → allowed
  assert.equal(
    evaluateAppAccess(p, caller({ role: 'manager' }), 'approve', { amount: 90000 }).allow,
    true,
  );
  // manager OVER threshold → rejected (authority ceiling)
  const over = evaluateAppAccess(p, caller({ role: 'manager' }), 'approve', { amount: 200000 });
  assert.equal(over.allow, false);
  assert.match(over.reason, /exceeds approver authority/);
  // admin passes RBAC but is NOT in approverRoles → authority rejects even an admin
  const adminNoAuth = evaluateAppAccess(p, caller({ role: 'admin' }), 'approve', { amount: 10 });
  assert.equal(adminNoAuth.allow, false);
  assert.match(adminNoAuth.reason, /not an authorized approver/);
});

// ─── validation ─────────────────────────────────────────────────────────────────────────────────────
test('validateAppAccessPolicyInput: happy path', () => {
  const r = validateAppAccessPolicyInput({
    actions: {
      run: { roles: ['analyst'], departments: ['Finance'], attributes: [{ attribute: 'amount', operator: 'lte', value: '50000' }] },
    },
    approval: { approverRoles: ['manager'], approverUsers: ['cfo@corp'], thresholdAttribute: 'amount', maxThreshold: 50000 },
  });
  assert.equal(r.ok, true);
  assert.ok(r.value);
  assert.deepEqual(r.value!.actions.run!.roles, ['analyst']);
  assert.equal(r.value!.approval!.maxThreshold, 50000);
});

test('validateAppAccessPolicyInput: rejects bad shapes', () => {
  assert.equal(validateAppAccessPolicyInput({ actions: [] }).ok, false);
  assert.equal(validateAppAccessPolicyInput({ actions: { bogus: {} } }).ok, false);
  assert.equal(validateAppAccessPolicyInput({ actions: { run: { roles: 'x' } } }).ok, false);
  assert.equal(validateAppAccessPolicyInput({ actions: { run: { departments: 5 } } }).ok, false);
  assert.equal(
    validateAppAccessPolicyInput({ actions: { run: { attributes: [{ attribute: 'x', operator: 'bad', value: 'y' }] } } }).ok,
    false,
  );
  assert.equal(
    validateAppAccessPolicyInput({ actions: { run: { attributes: [{ operator: 'eq', value: 'y' }] } } }).ok,
    false,
  );
  assert.equal(validateAppAccessPolicyInput({ actions: { run: { attributes: 'nope' } } }).ok, false);
  assert.equal(validateAppAccessPolicyInput({ approval: { approverRoles: 5 } }).ok, false);
  assert.equal(validateAppAccessPolicyInput({ approval: { maxThreshold: 'x' } }).ok, false);
  assert.equal(validateAppAccessPolicyInput({ approval: { thresholdAttribute: 5 } }).ok, false);
  assert.equal(validateAppAccessPolicyInput({ approval: { approverUsers: [1] } }).ok, false);
});

test('validateAppAccessPolicyInput: empty body → valid empty policy; approval null ignored', () => {
  const r = validateAppAccessPolicyInput({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.value!.actions, {});
  assert.equal(r.value!.approval, undefined);
  const r2 = validateAppAccessPolicyInput({ approval: null });
  assert.equal(r2.ok, true);
});

test('constants are exhaustive', () => {
  assert.deepEqual([...APP_ACTIONS].sort(), ['approve', 'edit', 'run', 'trigger', 'view']);
  assert.ok(ABAC_OPERATORS.includes('lte'));
  assert.ok(ABAC_OPERATORS.includes('eq'));
});
