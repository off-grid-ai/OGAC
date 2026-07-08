import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dbReachable, SKIP_MESSAGE } from './support/db-available.mjs';

// M2 lifecycle & ownership INTEGRATION tests — the REAL team store, team.id_id edge, and the
// promote→approve→publish lifecycle path against a REAL Postgres, no mocks. Exercises:
//   • team CRUD + membership scoping (no cross-team / cross-org leak);
//   • pipelines.team_id persists + listPipelinesByTeam reads it back;
//   • owner reassign (metadata mutation — does NOT bump the governance version);
//   • the promotion gate: draft →(promote)→ in_review →(approve = publishWithGate)→ published, with
//     an OUTSIDER forbidden and a MEMBER unable to self-promote; then deprecate.
// Skips (green) when no DB is up. All rows are under a dedicated org id so real data is untouched.

const dbUp = await dbReachable();

test('M2 teams + lifecycle + ownership (real Postgres)', { skip: dbUp ? false : SKIP_MESSAGE }, async (t) => {
  const { createTeam, getTeam, listTeams, updateTeam, deleteTeam, addTeamMember, listTeamMembers, removeTeamMember, listMembershipsForUser } =
    await import('@/lib/teams');
  const { createPipeline, getPipeline, listPipelinesByTeam, setPipelineTeam, reassignPipelineOwner, listPipelineVersions, deletePipeline } =
    await import('@/lib/pipelines');
  const { transitionPipeline, resolvePipelineRole } = await import('@/lib/pipeline-lifecycle');

  const marker = `m2-${Date.now()}`;
  const orgId = `org-${marker}`;
  const otherOrg = `org-${marker}-other`;

  const owner = 'owner@corp.example';
  const lead = 'lead@corp.example';
  const member = 'member@corp.example';
  const outsider = 'outsider@corp.example';
  const admin = { email: 'admin@corp.example', role: 'admin' };
  const approver = { email: 'compliance@corp.example', role: 'compliance' };

  const createdTeams: string[] = [];
  const createdPipelines: { id: string; org: string }[] = [];
  t.after(async () => {
    for (const p of createdPipelines) await deletePipeline(p.id, p.org).catch(() => {});
    for (const id of createdTeams) {
      await deleteTeam(id, orgId).catch(() => {});
      await deleteTeam(id, otherOrg).catch(() => {});
    }
  });

  // ── 1. TEAM CRUD ────────────────────────────────────────────────────────────────────────────────
  const team = await createTeam({ name: 'Tax & Accounting' }, orgId);
  createdTeams.push(team.id);
  assert.match(team.id, /^tm_/, 'team id is prefixed');
  assert.equal(team.memberCount, 0);

  const fetched = await getTeam(team.id, orgId);
  assert.equal(fetched!.name, 'Tax & Accounting');

  const renamed = await updateTeam(team.id, { name: 'Tax', description: 'BU' }, orgId);
  assert.equal(renamed!.name, 'Tax');
  assert.equal(renamed!.description, 'BU');

  // org-scoped: another org sees none of this org's teams.
  assert.equal((await listTeams(otherOrg)).length, 0, 'no cross-org team leak');
  assert.equal((await listTeams(orgId)).length, 1);

  // ── 2. MEMBERSHIP + scoping ───────────────────────────────────────────────────────────────────
  await addTeamMember(team.id, lead, 'lead', orgId);
  await addTeamMember(team.id, member, 'member', orgId);
  const members = await listTeamMembers(team.id, orgId);
  assert.equal(members.length, 2);
  // re-adding a member UPDATES the role (upsert), not duplicate.
  await addTeamMember(team.id, member, 'lead', orgId);
  const afterUpsert = await listTeamMembers(team.id, orgId);
  assert.equal(afterUpsert.length, 2, 'upsert on (team,user), no duplicate');
  assert.equal(afterUpsert.find((m) => m.userId === member)!.role, 'lead');
  // reset member back to a plain member for the RBAC checks below.
  await addTeamMember(team.id, member, 'member', orgId);

  // membership feed for the RBAC resolver — the lead sees exactly their one membership.
  const leadMemberships = await listMembershipsForUser(lead, orgId);
  assert.equal(leadMemberships.length, 1);
  assert.equal(leadMemberships[0].teamId, team.id);
  // an outsider has no memberships.
  assert.equal((await listMembershipsForUser(outsider, orgId)).length, 0);

  // ── 3. pipelines.team_id persists + listPipelinesByTeam ────────────────────────────────────────
  const p = await createPipeline({ name: `${marker} pipeline`, teamId: team.id }, owner, orgId);
  createdPipelines.push({ id: p.id, org: orgId });
  assert.equal(p.teamId, team.id, 'team_id persisted on create');

  const byTeam = await listPipelinesByTeam(team.id, orgId);
  assert.equal(byTeam.length, 1);
  assert.equal(byTeam[0].id, p.id);

  // move it off the team, then back — the metadata write is honoured and does NOT bump version.
  const versionBefore = (await getPipeline(p.id, orgId))!.version;
  await setPipelineTeam(p.id, null, orgId);
  assert.equal((await getPipeline(p.id, orgId))!.teamId, null);
  await setPipelineTeam(p.id, team.id, orgId);
  const afterTeamMoves = await getPipeline(p.id, orgId);
  assert.equal(afterTeamMoves!.teamId, team.id);
  assert.equal(afterTeamMoves!.version, versionBefore, 'team move does not bump the governance version');

  // ── 4. owner reassign (metadata — no version bump) ─────────────────────────────────────────────
  const reassigned = await reassignPipelineOwner(p.id, lead, orgId);
  assert.equal(reassigned!.ownerId, lead);
  assert.equal(reassigned!.version, versionBefore, 'owner reassign does not bump the version');
  // put ownership back to `owner` for the lifecycle checks.
  await reassignPipelineOwner(p.id, owner, orgId);

  // ── 5. RBAC role resolution on the pipeline ────────────────────────────────────────────────────
  assert.equal(await resolvePipelineRole({ email: owner }, afterTeamMoves!, orgId), 'editor');
  assert.equal(await resolvePipelineRole({ email: lead }, afterTeamMoves!, orgId), 'editor');
  assert.equal(await resolvePipelineRole({ email: member }, afterTeamMoves!, orgId), 'member');
  assert.equal(await resolvePipelineRole({ email: outsider }, afterTeamMoves!, orgId), 'none');
  assert.equal(await resolvePipelineRole(admin, afterTeamMoves!, orgId), 'admin');

  // ── 6. the promotion gate: promote → approve → published ───────────────────────────────────────
  // an OUTSIDER cannot promote (no access).
  const byOutsider = await transitionPipeline(p.id, 'promote', { email: outsider }, { orgId });
  assert.equal(byOutsider.forbidden, true, 'outsider cannot promote');

  // a MEMBER cannot self-promote a draft for review (needs editor).
  const byMember = await transitionPipeline(p.id, 'promote', { email: member }, { orgId });
  assert.equal(byMember.forbidden, true, 'a plain member cannot promote');

  // the OWNER submits for review.
  const promoted = await transitionPipeline(p.id, 'promote', { email: owner }, { orgId });
  assert.equal(promoted.ok, true);
  assert.equal(promoted.pipeline!.status, 'in_review');

  // the OWNER cannot self-approve (approval needs an approver/admin).
  const selfApprove = await transitionPipeline(p.id, 'approve', { email: owner }, { orgId });
  assert.equal(selfApprove.forbidden, true, 'no self-approve — the sign-off gate');

  // an APPROVER approves → runs through the release gate (no evals attached ⇒ ungated pass) → published.
  const approved = await transitionPipeline(p.id, 'approve', approver, { orgId });
  assert.equal(approved.ok, true, 'approver may approve');
  assert.ok(!approved.blocked, 'no evals ⇒ gate ungated ⇒ not blocked');
  assert.equal(approved.pipeline!.status, 'published');
  assert.equal(approved.gate!.decision.gated, false);

  // the approve froze a published version snapshot (M1 path reused).
  const versions = await listPipelineVersions(p.id, orgId);
  assert.ok(versions.some((v) => v.note === 'published'), 'approve → published snapshot frozen');

  // ── 7. deprecate — anyone with access (a member) may retire their team's pipeline ──────────────
  const deprecated = await transitionPipeline(p.id, 'deprecate', { email: member }, { orgId });
  assert.equal(deprecated.ok, true, 'a team member may deprecate');
  assert.equal(deprecated.pipeline!.status, 'deprecated');

  // revive (editor) back to draft.
  const revived = await transitionPipeline(p.id, 'revive', { email: owner }, { orgId });
  assert.equal(revived.ok, true);
  assert.equal(revived.pipeline!.status, 'draft');

  // ── 8. delete team + membership cleanup ────────────────────────────────────────────────────────
  await removeTeamMember(afterUpsert.find((m) => m.userId === lead)!.id, orgId);
  assert.equal((await listTeamMembers(team.id, orgId)).length, 1, 'member removed');
  await deleteTeam(team.id, orgId);
  assert.equal(await getTeam(team.id, orgId), null, 'team deleted');
  assert.equal((await listTeamMembers(team.id, orgId)).length, 0, 'memberships cascade-deleted');
});
