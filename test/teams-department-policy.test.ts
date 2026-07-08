import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UNASSIGNED_DEPARTMENT,
  distinctDepartments,
  groupTeamsByDepartment,
  normalizeDepartment,
  validateTeamCreate,
  validateTeamUpdate,
} from '../src/lib/teams-policy.ts';

// PURE unit tests for the M2-a (#189) department grouping — the org-chart backbone. Zero IO.

test('normalizeDepartment: trims, empty ⇒ null, non-string ⇒ null', () => {
  assert.equal(normalizeDepartment('  Finance  '), 'Finance');
  assert.equal(normalizeDepartment(''), null);
  assert.equal(normalizeDepartment('   '), null);
  assert.equal(normalizeDepartment(null), null);
  assert.equal(normalizeDepartment(undefined), null);
  assert.equal(normalizeDepartment(42), null);
});

test('groupTeamsByDepartment: named buckets sorted, Unassigned last, order within preserved', () => {
  const teams = [
    { id: 'a', department: 'Operations' },
    { id: 'b', department: 'Finance' },
    { id: 'c', department: null },
    { id: 'd', department: 'Finance' },
    { id: 'e', department: '   ' }, // whitespace ⇒ Unassigned
  ];
  const groups = groupTeamsByDepartment(teams);
  assert.deepEqual(
    groups.map((g) => g.department),
    ['Finance', 'Operations', UNASSIGNED_DEPARTMENT],
    'named sorted case-insensitively, Unassigned last',
  );
  // Finance keeps input order (b before d).
  assert.deepEqual(groups[0].teams.map((t) => t.id), ['b', 'd']);
  assert.equal(groups[0].unassigned, false);
  // Unassigned bucket collects null + whitespace-only.
  const unassigned = groups[2];
  assert.equal(unassigned.unassigned, true);
  assert.deepEqual(unassigned.teams.map((t) => t.id), ['c', 'e']);
});

test('groupTeamsByDepartment: no Unassigned bucket when every team has a department', () => {
  const groups = groupTeamsByDepartment([
    { id: 'a', department: 'Risk' },
    { id: 'b', department: 'Risk' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].department, 'Risk');
  assert.equal(groups.some((g) => g.unassigned), false);
});

test('groupTeamsByDepartment: empty input ⇒ no groups', () => {
  assert.deepEqual(groupTeamsByDepartment([]), []);
});

test('groupTeamsByDepartment: only-unassigned input ⇒ single Unassigned bucket', () => {
  const groups = groupTeamsByDepartment([{ id: 'a', department: null }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].department, UNASSIGNED_DEPARTMENT);
  assert.equal(groups[0].unassigned, true);
});

test('distinctDepartments: sorted, de-duplicated, excludes null/empty', () => {
  const departments = distinctDepartments([
    { department: 'Operations' },
    { department: 'Finance' },
    { department: 'finance' }, // distinct string kept (case-sensitive de-dupe by exact value)
    { department: 'Finance' },
    { department: null },
    { department: '  ' },
  ]);
  // 'Finance' de-duped once; 'finance' is a separate distinct value; sorted case-insensitively.
  assert.deepEqual(departments, ['Finance', 'finance', 'Operations']);
});

test('validateTeamCreate/Update: department optional + bounded, additive to prior rules', () => {
  // department is optional — omitting it is still valid.
  assert.equal(validateTeamCreate({ name: 'Tax' }).ok, true);
  assert.equal(validateTeamCreate({ name: 'Tax', department: 'Finance' }).ok, true);
  assert.equal(validateTeamCreate({ name: 'Tax', department: null }).ok, true);
  // a non-string department is rejected.
  assert.equal(validateTeamCreate({ name: 'Tax', department: 123 }).ok, false);
  // over-long department is rejected.
  assert.equal(validateTeamCreate({ name: 'Tax', department: 'x'.repeat(121) }).ok, false);
  // update: department may be cleared (null) or set.
  assert.equal(validateTeamUpdate({ department: null }).ok, true);
  assert.equal(validateTeamUpdate({ department: 'Risk' }).ok, true);
  assert.equal(validateTeamUpdate({ department: 999 }).ok, false);
  // prior name rule still enforced (additive, not replaced).
  assert.equal(validateTeamCreate({ name: '', department: 'Finance' }).ok, false);
});
