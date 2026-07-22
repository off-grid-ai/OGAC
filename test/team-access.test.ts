import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LifecycleRole } from '../src/lib/pipeline-lifecycle-model.ts';
import {
  type TeamEntityAction,
  TEAM_ENTITY_ACTIONS,
  canActOnTeamEntity,
  isTeamEntityAction,
  minRoleForAction,
  resolveTeamEntityRole,
  teamRoleGrantsAction,
} from '../src/lib/team-access.ts';
import type { Membership } from '../src/lib/teams-policy.ts';

// PURE unit tests for the entity-agnostic team-scoped access rule — the ONE rule that scopes BOTH
// pipelines and apps by team membership + role. Every role × action allow AND deny arm is exercised
// so the delegated-access ceiling is provable: a `member` reads/runs, a `lead` edits/triggers, a
// non-member/non-owner gets nothing, and destructive/approve actions stay above the delegated tier.

const ADMIN = { email: 'admin@corp.example', isAdmin: true };
const APPROVER = { email: 'compliance@corp.example', isAdmin: false, isApprover: true };
const OWNER = { email: 'owner@corp.example', isAdmin: false };
const LEAD = { email: 'lead@corp.example', isAdmin: false };
const MEMBER = { email: 'member@corp.example', isAdmin: false };
const OUTSIDER = { email: 'outsider@corp.example', isAdmin: false };

const memberships: Membership[] = [
  { teamId: 'tm_alpha', userId: 'lead@corp.example', role: 'lead' },
  { teamId: 'tm_alpha', userId: 'member@corp.example', role: 'member' },
];

// A team-governed APP (same shape as a pipeline): owner + governing team.
const alphaApp = { ownerId: 'owner@corp.example', teamId: 'tm_alpha' };
const orphanApp = { ownerId: 'owner@corp.example', teamId: null };

// ─── role → capability mapping (teamRoleGrantsAction) ────────────────────────────────────────────
test('teamRoleGrantsAction: none grants nothing', () => {
  for (const action of TEAM_ENTITY_ACTIONS) {
    assert.equal(teamRoleGrantsAction('none', action), false, `none must not grant ${action}`);
  }
});

test('teamRoleGrantsAction: member grants view + run only', () => {
  assert.equal(teamRoleGrantsAction('member', 'view'), true);
  assert.equal(teamRoleGrantsAction('member', 'run'), true);
  assert.equal(teamRoleGrantsAction('member', 'trigger'), false);
  assert.equal(teamRoleGrantsAction('member', 'edit'), false);
  assert.equal(teamRoleGrantsAction('member', 'approve'), false);
  assert.equal(teamRoleGrantsAction('member', 'delete'), false);
});

test('teamRoleGrantsAction: editor grants view/run/trigger/edit, not approve/delete', () => {
  assert.equal(teamRoleGrantsAction('editor', 'view'), true);
  assert.equal(teamRoleGrantsAction('editor', 'run'), true);
  assert.equal(teamRoleGrantsAction('editor', 'trigger'), true);
  assert.equal(teamRoleGrantsAction('editor', 'edit'), true);
  assert.equal(teamRoleGrantsAction('editor', 'approve'), false);
  assert.equal(teamRoleGrantsAction('editor', 'delete'), false);
});

test('teamRoleGrantsAction: approver adds approve but not delete', () => {
  assert.equal(teamRoleGrantsAction('approver', 'edit'), true);
  assert.equal(teamRoleGrantsAction('approver', 'approve'), true);
  assert.equal(teamRoleGrantsAction('approver', 'delete'), false);
});

test('teamRoleGrantsAction: admin grants every action', () => {
  for (const action of TEAM_ENTITY_ACTIONS) {
    assert.equal(teamRoleGrantsAction('admin', action), true, `admin must grant ${action}`);
  }
});

// ─── minRoleForAction ────────────────────────────────────────────────────────────────────────────
test('minRoleForAction maps each action to its floor role', () => {
  const expected: Record<TeamEntityAction, LifecycleRole> = {
    view: 'member',
    run: 'member',
    trigger: 'editor',
    edit: 'editor',
    approve: 'approver',
    delete: 'admin',
  };
  for (const action of TEAM_ENTITY_ACTIONS) {
    assert.equal(minRoleForAction(action), expected[action]);
  }
});

// ─── isTeamEntityAction ──────────────────────────────────────────────────────────────────────────
test('isTeamEntityAction accepts valid actions, rejects junk', () => {
  assert.equal(isTeamEntityAction('run'), true);
  assert.equal(isTeamEntityAction('delete'), true);
  assert.equal(isTeamEntityAction('nuke'), false);
  assert.equal(isTeamEntityAction(42), false);
  assert.equal(isTeamEntityAction(undefined), false);
});

// ─── resolveTeamEntityRole reuses the central resolver (pipelines + apps identical) ────────────────
test('resolveTeamEntityRole: admin → admin, owner → editor, lead → editor, member → member', () => {
  assert.equal(resolveTeamEntityRole(ADMIN, alphaApp, memberships), 'admin');
  assert.equal(resolveTeamEntityRole(OWNER, alphaApp, memberships), 'editor');
  assert.equal(resolveTeamEntityRole(LEAD, alphaApp, memberships), 'editor');
  assert.equal(resolveTeamEntityRole(MEMBER, alphaApp, memberships), 'member');
  assert.equal(resolveTeamEntityRole(OUTSIDER, alphaApp, memberships), 'none');
});

test('resolveTeamEntityRole: approver flag lifts an outsider to approver', () => {
  assert.equal(resolveTeamEntityRole(APPROVER, alphaApp, memberships), 'approver');
});

test('resolveTeamEntityRole: an orphan (no team) gives non-owner/non-admin nothing', () => {
  assert.equal(resolveTeamEntityRole(LEAD, orphanApp, memberships), 'none');
  assert.equal(resolveTeamEntityRole(MEMBER, orphanApp, memberships), 'none');
  assert.equal(resolveTeamEntityRole(OWNER, orphanApp, memberships), 'editor');
  assert.equal(resolveTeamEntityRole(ADMIN, orphanApp, memberships), 'admin');
});

// ─── the composed decision (canActOnTeamEntity) — allow AND deny arms ──────────────────────────────
test('canActOnTeamEntity: a team MEMBER can view + run, cannot edit/delete', () => {
  assert.equal(canActOnTeamEntity(MEMBER, alphaApp, memberships, 'view').allow, true);
  assert.equal(canActOnTeamEntity(MEMBER, alphaApp, memberships, 'run').allow, true);
  const edit = canActOnTeamEntity(MEMBER, alphaApp, memberships, 'edit');
  assert.equal(edit.allow, false);
  assert.equal(edit.role, 'member');
  assert.match(edit.reason, /below the editor/);
  assert.equal(canActOnTeamEntity(MEMBER, alphaApp, memberships, 'delete').allow, false);
});

test('canActOnTeamEntity: a team LEAD can edit + trigger, cannot approve/delete', () => {
  assert.equal(canActOnTeamEntity(LEAD, alphaApp, memberships, 'edit').allow, true);
  assert.equal(canActOnTeamEntity(LEAD, alphaApp, memberships, 'trigger').allow, true);
  assert.equal(canActOnTeamEntity(LEAD, alphaApp, memberships, 'approve').allow, false);
  assert.equal(canActOnTeamEntity(LEAD, alphaApp, memberships, 'delete').allow, false);
});

test('canActOnTeamEntity: an OUTSIDER is denied every action (no cross-team leak)', () => {
  for (const action of TEAM_ENTITY_ACTIONS) {
    const d = canActOnTeamEntity(OUTSIDER, alphaApp, memberships, action);
    assert.equal(d.allow, false, `outsider must be denied ${action}`);
    assert.equal(d.role, 'none');
    assert.match(d.reason, /no team access/);
  }
});

test('canActOnTeamEntity: the OWNER can edit but not delete/approve (delegated ≤ editor)', () => {
  assert.equal(canActOnTeamEntity(OWNER, alphaApp, memberships, 'edit').allow, true);
  assert.equal(canActOnTeamEntity(OWNER, alphaApp, memberships, 'approve').allow, false);
  assert.equal(canActOnTeamEntity(OWNER, alphaApp, memberships, 'delete').allow, false);
});

test('canActOnTeamEntity: an ADMIN can take every action, and the reason names the role', () => {
  for (const action of TEAM_ENTITY_ACTIONS) {
    const d = canActOnTeamEntity(ADMIN, alphaApp, memberships, action);
    assert.equal(d.allow, true, `admin must be allowed ${action}`);
    assert.equal(d.role, 'admin');
    assert.match(d.reason, /permitted \(role admin\)/);
  }
});

test('canActOnTeamEntity: an APPROVER can approve but not delete', () => {
  assert.equal(canActOnTeamEntity(APPROVER, alphaApp, memberships, 'approve').allow, true);
  assert.equal(canActOnTeamEntity(APPROVER, alphaApp, memberships, 'delete').allow, false);
});
