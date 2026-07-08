import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Membership,
  hasPipelineAccess,
  resolveLifecycleRole,
  teamAccessRole,
  validateMember,
  validateOwnerReassign,
  validateTeamCreate,
  validateTeamUpdate,
} from '../src/lib/teams-policy.ts';

// PURE unit tests for the M2 team/ownership RBAC rules — membership access checks + owner-reassign
// validation. These prove the delegated-access rule that gives teams their teeth: a team member acts
// on their team's pipelines, and a non-member/non-owner gets nothing (no cross-team leak).

const ADMIN = { email: 'admin@corp.example', isAdmin: true };
const APPROVER = { email: 'compliance@corp.example', isAdmin: false, isApprover: true };
const OWNER = { email: 'owner@corp.example', isAdmin: false };
const LEAD = { email: 'lead@corp.example', isAdmin: false };
const MEMBER = { email: 'member@corp.example', isAdmin: false };
const OUTSIDER = { email: 'outsider@corp.example', isAdmin: false };

const memberships: Membership[] = [
  { teamId: 'tm_alpha', userId: 'lead@corp.example', role: 'lead' },
  { teamId: 'tm_alpha', userId: 'member@corp.example', role: 'member' },
  { teamId: 'tm_beta', userId: 'lead@corp.example', role: 'member' },
];

const alphaPipeline = { ownerId: 'owner@corp.example', teamId: 'tm_alpha' };
const orphanPipeline = { ownerId: 'owner@corp.example', teamId: null };

test('teamAccessRole: lead delegates editor, member delegates member', () => {
  assert.equal(teamAccessRole('lead'), 'editor');
  assert.equal(teamAccessRole('member'), 'member');
});

test('admin resolves to admin on any pipeline (cross-all)', () => {
  assert.equal(resolveLifecycleRole(ADMIN, alphaPipeline, []), 'admin');
  assert.equal(resolveLifecycleRole(ADMIN, orphanPipeline, []), 'admin');
});

test('owner resolves to at least editor on their own pipeline', () => {
  assert.equal(resolveLifecycleRole(OWNER, alphaPipeline, memberships), 'editor');
  assert.equal(resolveLifecycleRole(OWNER, orphanPipeline, []), 'editor');
});

test('team lead → editor, team member → member on the team pipeline', () => {
  assert.equal(resolveLifecycleRole(LEAD, alphaPipeline, memberships), 'editor');
  assert.equal(resolveLifecycleRole(MEMBER, alphaPipeline, memberships), 'member');
});

test('NO cross-team leak: an outsider (non-owner, non-member, non-admin) gets none', () => {
  assert.equal(resolveLifecycleRole(OUTSIDER, alphaPipeline, memberships), 'none');
  assert.equal(hasPipelineAccess(OUTSIDER, alphaPipeline, memberships), false);
  // a member of team beta has NO access to a team-alpha pipeline.
  const betaOnly: Membership[] = [{ teamId: 'tm_beta', userId: 'x@corp.example', role: 'lead' }];
  assert.equal(
    resolveLifecycleRole({ email: 'x@corp.example', isAdmin: false }, alphaPipeline, betaOnly),
    'none',
  );
});

test('an orphan pipeline (no team) is reachable only by owner + admin', () => {
  assert.equal(resolveLifecycleRole(LEAD, orphanPipeline, memberships), 'none');
  assert.equal(resolveLifecycleRole(MEMBER, orphanPipeline, memberships), 'none');
  assert.equal(resolveLifecycleRole(OWNER, orphanPipeline, memberships), 'editor');
});

test('approver flag lifts to approver, and MAX wins when owner+approver overlap', () => {
  assert.equal(resolveLifecycleRole(APPROVER, orphanPipeline, []), 'approver');
  // an approver who also owns the pipeline: approver (3) > editor (2) → approver.
  const ownerApprover = { email: 'owner@corp.example', isAdmin: false, isApprover: true };
  assert.equal(resolveLifecycleRole(ownerApprover, alphaPipeline, memberships), 'approver');
});

test('resolveLifecycleRole is case-insensitive on emails', () => {
  const upperOwner = { email: 'OWNER@CORP.EXAMPLE', isAdmin: false };
  assert.equal(resolveLifecycleRole(upperOwner, alphaPipeline, memberships), 'editor');
});

test('validateTeamCreate / Update: name required + bounded', () => {
  assert.equal(validateTeamCreate({ name: 'Tax' }).ok, true);
  assert.equal(validateTeamCreate({ name: '' }).ok, false);
  assert.equal(validateTeamCreate({}).ok, false);
  assert.equal(validateTeamCreate({ name: 'x'.repeat(121) }).ok, false);
  assert.equal(validateTeamCreate({ name: 'ok', description: 123 }).ok, false);
  // update: name optional, but if present must be non-empty.
  assert.equal(validateTeamUpdate({}).ok, true);
  assert.equal(validateTeamUpdate({ description: 'edited' }).ok, true);
  assert.equal(validateTeamUpdate({ name: '' }).ok, false);
});

test('validateMember: userId required + role in set', () => {
  assert.equal(validateMember({ userId: 'a@b.com' }).ok, true);
  assert.equal(validateMember({ userId: 'a@b.com', role: 'lead' }).ok, true);
  assert.equal(validateMember({ userId: '' }).ok, false);
  assert.equal(validateMember({ userId: 'a@b.com', role: 'boss' }).ok, false);
});

test('validateOwnerReassign: non-empty, changed, bounded', () => {
  const ok = validateOwnerReassign({ currentOwnerId: 'a@b.com', newOwnerId: 'c@b.com' });
  assert.equal(ok.ok, true);
  assert.equal(ok.ownerId, 'c@b.com');
  // empty is rejected.
  assert.equal(validateOwnerReassign({ currentOwnerId: 'a@b.com', newOwnerId: '' }).ok, false);
  // a no-op reassign (same owner, case-insensitive) is rejected.
  assert.equal(
    validateOwnerReassign({ currentOwnerId: 'a@b.com', newOwnerId: 'A@B.COM' }).ok,
    false,
  );
  // trims the returned owner id.
  assert.equal(
    validateOwnerReassign({ currentOwnerId: 'a@b.com', newOwnerId: '  c@b.com  ' }).ownerId,
    'c@b.com',
  );
});
