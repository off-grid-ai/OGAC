import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// M2-a (#189) DEPARTMENT grouping INTEGRATION tests — the REAL team store against a REAL Postgres,
// no mocks. Proves:
//   • department persists on create + survives read-back;
//   • update sets and CLEARS (null ⇒ Unassigned) the department;
//   • the pure grouping helper over the real listTeams() returns correct department buckets;
//   • no cross-org leak (another org sees none of this org's teams/departments).
// Skips (green) when no DB is up. All rows live under a dedicated org id so real data is untouched.

const dbUp = await dbReachable();

test('M2-a team department persist + grouping (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createTeam, getTeam, listTeams, updateTeam, deleteTeam } = await import('@/lib/teams');
  const { groupTeamsByDepartment, distinctDepartments, UNASSIGNED_DEPARTMENT } = await import(
    '@/lib/teams-policy'
  );

  const marker = `dept-${Date.now()}`;
  const orgId = `org-${marker}`;
  const otherOrg = `org-${marker}-other`;

  const created: { id: string; org: string }[] = [];
  t.after(async () => {
    for (const c of created) await deleteTeam(c.id, c.org).catch(() => {});
  });

  // ── 1. department persists on create ──────────────────────────────────────────────────────────
  const fin = await createTeam({ name: 'Tax & Accounting', department: 'Finance' }, orgId);
  created.push({ id: fin.id, org: orgId });
  assert.equal(fin.department, 'Finance', 'department returned on create');
  const finRead = await getTeam(fin.id, orgId);
  assert.equal(finRead!.department, 'Finance', 'department survives read-back');

  // an empty-string department normalises to null (⇒ Unassigned).
  const noDept = await createTeam({ name: 'Ad-hoc', department: '   ' }, orgId);
  created.push({ id: noDept.id, org: orgId });
  assert.equal(noDept.department, null, 'whitespace department ⇒ null');

  // a team created with no department field is null.
  const risk = await createTeam({ name: 'Model Risk', department: 'Risk' }, orgId);
  created.push({ id: risk.id, org: orgId });
  const bare = await createTeam({ name: 'Bare' }, orgId);
  created.push({ id: bare.id, org: orgId });
  assert.equal(bare.department, null);

  // ── 2. update sets + clears the department ────────────────────────────────────────────────────
  const moved = await updateTeam(bare.id, { department: 'Finance' }, orgId);
  assert.equal(moved!.department, 'Finance', 'update sets department');
  const cleared = await updateTeam(bare.id, { department: null }, orgId);
  assert.equal(cleared!.department, null, 'update clears department ⇒ Unassigned');
  // updating name only leaves department unchanged.
  await updateTeam(fin.id, { name: 'Tax' }, orgId);
  assert.equal((await getTeam(fin.id, orgId))!.department, 'Finance', 'name-only update keeps dept');

  // ── 3. grouping over the REAL listTeams ───────────────────────────────────────────────────────
  const all = await listTeams(orgId);
  assert.equal(all.length, 4);
  const groups = groupTeamsByDepartment(all);
  const labels = groups.map((g) => g.department);
  // named departments sorted first (Finance, Risk), Unassigned last.
  assert.deepEqual(labels, ['Finance', 'Risk', UNASSIGNED_DEPARTMENT]);
  const financeGroup = groups.find((g) => g.department === 'Finance')!;
  assert.equal(financeGroup.teams.length, 1, 'only "Tax" is Finance now');
  assert.equal(financeGroup.teams[0].id, fin.id);
  const unassignedGroup = groups.find((g) => g.unassigned)!;
  assert.deepEqual(
    unassignedGroup.teams.map((tm) => tm.id).sort(),
    [noDept.id, bare.id].sort(),
    'both cleared teams fall into Unassigned',
  );
  assert.deepEqual(distinctDepartments(all), ['Finance', 'Risk']);

  // ── 4. no cross-org leak ──────────────────────────────────────────────────────────────────────
  assert.equal((await listTeams(otherOrg)).length, 0, 'no cross-org team/department leak');
});
