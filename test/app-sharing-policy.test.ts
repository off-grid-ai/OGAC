import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APP_SHARE_ROLES,
  HIERARCHY_INHERITED_ROLE,
  actionsForShareRole,
  evaluateShareAccess,
  grantRoleForUser,
  isAppShareRole,
  isInManagementChain,
  normalizeShareRole,
  normalizeUserId,
  removeGrant,
  resolveManagementChain,
  sanitizeGrants,
  shareRolePermits,
  upsertGrant,
  type AppGrant,
  type OrgChartMembership,
} from '../src/lib/app-sharing-policy.ts';

// Pure grant + upward-hierarchy resolution. Zero-IO — every role→action, grant-precedence, and
// hierarchy-inheritance branch exercised without a DB (SOLID coverage bar).

// ─── role vocabulary + role→action mapping ──────────────────────────────────────────────────────────
test('isAppShareRole / normalizeShareRole', () => {
  assert.equal(isAppShareRole('editor'), true);
  assert.equal(isAppShareRole('owner'), false);
  assert.equal(isAppShareRole(42), false);
  assert.equal(normalizeShareRole('approver'), 'approver');
  assert.equal(normalizeShareRole('bogus'), 'viewer'); // least-privileged default
  assert.equal(normalizeShareRole(undefined), 'viewer');
});

test('actionsForShareRole is a cumulative ladder', () => {
  assert.deepEqual([...actionsForShareRole('viewer')], ['view']);
  assert.deepEqual([...actionsForShareRole('runner')], ['view', 'run', 'trigger']);
  assert.deepEqual([...actionsForShareRole('approver')], ['view', 'run', 'trigger', 'approve']);
  assert.deepEqual([...actionsForShareRole('editor')], ['view', 'run', 'trigger', 'approve', 'edit']);
  // Every role includes 'view'; only editor includes 'edit'.
  for (const r of APP_SHARE_ROLES) assert.equal(shareRolePermits(r, 'view'), true);
  assert.equal(shareRolePermits('viewer', 'run'), false);
  assert.equal(shareRolePermits('runner', 'approve'), false);
  assert.equal(shareRolePermits('approver', 'edit'), false);
  assert.equal(shareRolePermits('editor', 'edit'), true);
});

// ─── normalizeUserId ────────────────────────────────────────────────────────────────────────────────
test('normalizeUserId trims + lowercases; non-strings → empty', () => {
  assert.equal(normalizeUserId('  Alice@Corp.IN  '), 'alice@corp.in');
  assert.equal(normalizeUserId(123), '');
  assert.equal(normalizeUserId(undefined), '');
});

// ─── grant upsert / remove / lookup ──────────────────────────────────────────────────────────────────
test('upsertGrant adds, replaces by user, ignores empty user id, normalises', () => {
  let g: AppGrant[] = [];
  g = upsertGrant(g, 'A@corp', 'runner');
  assert.deepEqual(g, [{ userId: 'a@corp', role: 'runner' }]);
  // re-grant same user replaces role, does not duplicate
  g = upsertGrant(g, 'a@corp', 'editor');
  assert.deepEqual(g, [{ userId: 'a@corp', role: 'editor' }]);
  // a new user is appended; unknown role coerced to viewer
  g = upsertGrant(g, 'b@corp', 'bogus');
  assert.deepEqual(g, [
    { userId: 'a@corp', role: 'editor' },
    { userId: 'b@corp', role: 'viewer' },
  ]);
  // empty user id → returns a normalised copy, unchanged length
  const g2 = upsertGrant(g, '   ', 'editor');
  assert.equal(g2.length, 2);
  assert.notEqual(g2, g); // new list
});

test('removeGrant drops the user (case-insensitive), keeps others', () => {
  const g: AppGrant[] = [
    { userId: 'a@corp', role: 'editor' },
    { userId: 'b@corp', role: 'viewer' },
  ];
  assert.deepEqual(removeGrant(g, 'A@CORP'), [{ userId: 'b@corp', role: 'viewer' }]);
  assert.deepEqual(removeGrant(g, 'nobody'), g); // no-op keeps both
});

test('grantRoleForUser returns the role or null', () => {
  const g: AppGrant[] = [{ userId: 'a@corp', role: 'approver' }];
  assert.equal(grantRoleForUser(g, 'A@Corp'), 'approver');
  assert.equal(grantRoleForUser(g, 'x@corp'), null);
});

test('sanitizeGrants drops malformed + dedupes', () => {
  assert.deepEqual(sanitizeGrants('nope'), []);
  const out = sanitizeGrants([
    { userId: 'a@corp', role: 'runner' },
    { userId: '', role: 'editor' }, // dropped (empty)
    { userId: 'a@corp', role: 'editor' }, // dedupe → replaces
    { role: 'viewer' }, // dropped (no user)
  ]);
  assert.deepEqual(out, [{ userId: 'a@corp', role: 'editor' }]);
});

// ─── upward management chain ──────────────────────────────────────────────────────────────────────────
// Org chart: team T1 lead=boss, members=[alice]; team T2 lead=ceo, members=[boss].
// So alice → boss → ceo.
const CHART: OrgChartMembership[] = [
  { teamId: 'T1', userId: 'boss@corp', role: 'lead' },
  { teamId: 'T1', userId: 'alice@corp', role: 'member' },
  { teamId: 'T2', userId: 'ceo@corp', role: 'lead' },
  { teamId: 'T2', userId: 'boss@corp', role: 'member' },
];

test('resolveManagementChain climbs the reporting line, creator excluded, nearest-first', () => {
  assert.deepEqual(resolveManagementChain('alice@corp', CHART), ['boss@corp', 'ceo@corp']);
  // boss's chain is just the ceo (boss leads T1 but reports up via T2)
  assert.deepEqual(resolveManagementChain('ceo@corp', CHART), []);
  // a lead is not their own manager
  assert.deepEqual(resolveManagementChain('boss@corp', CHART), ['ceo@corp']);
});

test('resolveManagementChain: empty creator → empty; skips empty member ids', () => {
  assert.deepEqual(resolveManagementChain('', CHART), []);
  const chart: OrgChartMembership[] = [
    { teamId: 'T', userId: '', role: 'lead' },
    { teamId: 'T', userId: 'x@corp', role: 'member' },
  ];
  assert.deepEqual(resolveManagementChain('x@corp', chart), []);
});

test('resolveManagementChain guards cycles', () => {
  // A leads B's team, B leads A's team — mutual. Neither loops forever; each appears once.
  const cyclic: OrgChartMembership[] = [
    { teamId: 'TA', userId: 'a@corp', role: 'lead' },
    { teamId: 'TA', userId: 'b@corp', role: 'member' },
    { teamId: 'TB', userId: 'b@corp', role: 'lead' },
    { teamId: 'TB', userId: 'a@corp', role: 'member' },
  ];
  assert.deepEqual(resolveManagementChain('a@corp', cyclic), ['b@corp']);
  assert.deepEqual(resolveManagementChain('b@corp', cyclic), ['a@corp']);
});

test('isInManagementChain', () => {
  assert.equal(isInManagementChain('BOSS@corp', 'alice@corp', CHART), true);
  assert.equal(isInManagementChain('ceo@corp', 'alice@corp', CHART), true);
  assert.equal(isInManagementChain('alice@corp', 'boss@corp', CHART), false); // downward, not upward
  assert.equal(isInManagementChain('', 'alice@corp', CHART), false);
});

test('HIERARCHY_INHERITED_ROLE default is approver (view/run/trigger/approve, NOT edit)', () => {
  assert.equal(HIERARCHY_INHERITED_ROLE, 'approver');
  assert.equal(shareRolePermits(HIERARCHY_INHERITED_ROLE, 'approve'), true);
  assert.equal(shareRolePermits(HIERARCHY_INHERITED_ROLE, 'edit'), false);
});

// ─── the composed share decision ──────────────────────────────────────────────────────────────────────
test('evaluateShareAccess: explicit grant admits within its role', () => {
  const grants: AppGrant[] = [{ userId: 'a@corp', role: 'runner' }];
  const base = { creatorId: 'owner@corp', grants, memberships: [] as OrgChartMembership[] };
  assert.equal(evaluateShareAccess({ ...base, callerId: 'a@corp', action: 'run' }).allow, true);
  assert.equal(evaluateShareAccess({ ...base, callerId: 'a@corp', action: 'run' }).via, 'grant');
  // runner cannot approve or edit
  assert.equal(evaluateShareAccess({ ...base, callerId: 'a@corp', action: 'approve' }).allow, false);
  assert.equal(evaluateShareAccess({ ...base, callerId: 'a@corp', action: 'edit' }).allow, false);
  // an ungranted user gets nothing from the grant path
  assert.equal(evaluateShareAccess({ ...base, callerId: 'z@corp', action: 'view' }).via, 'none');
});

test('evaluateShareAccess: management chain inherits approver (auto-access)', () => {
  const base = { creatorId: 'alice@corp', grants: [] as AppGrant[], memberships: CHART };
  // boss (manager) inherits: can view/run/approve
  assert.equal(evaluateShareAccess({ ...base, callerId: 'boss@corp', action: 'view' }).allow, true);
  const approve = evaluateShareAccess({ ...base, callerId: 'boss@corp', action: 'approve' });
  assert.equal(approve.allow, true);
  assert.equal(approve.via, 'hierarchy');
  // but NOT edit — editing another's app stays with owner/explicit-editor/admin
  assert.equal(evaluateShareAccess({ ...base, callerId: 'boss@corp', action: 'edit' }).allow, false);
  // a non-chain peer gets nothing
  const peer = evaluateShareAccess({ ...base, callerId: 'stranger@corp', action: 'view' });
  assert.equal(peer.allow, false);
  assert.equal(peer.via, 'none');
});

test('evaluateShareAccess: grant takes precedence path over hierarchy but both can apply', () => {
  // boss is in the chain (approver) AND has an explicit editor grant → editor wins for edit.
  const grants: AppGrant[] = [{ userId: 'boss@corp', role: 'editor' }];
  const dec = evaluateShareAccess({
    callerId: 'boss@corp',
    creatorId: 'alice@corp',
    action: 'edit',
    grants,
    memberships: CHART,
  });
  assert.equal(dec.allow, true);
  assert.equal(dec.via, 'grant'); // grant checked first
});
