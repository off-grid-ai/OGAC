import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type LifecycleAction,
  type LifecycleRole,
  allowedTransitions,
  canTransition,
  isLifecycleStatus,
  normalizeLifecycleStatus,
  roleAtLeast,
  stageInfo,
  transitionTarget,
} from '../src/lib/pipeline-lifecycle-model.ts';

// PURE unit tests for the M2 promotion-gate lifecycle model. Exhaustive role × status matrix — the
// heart of "no plain-language pipeline reaches published without an approver + a passing gate".

const actionsOf = (status: string, role: LifecycleRole): LifecycleAction[] =>
  allowedTransitions(status, role).map((t) => t.action).sort();

test('draft: owner/editor may promote + deprecate; member may only deprecate; none nothing', () => {
  assert.deepEqual(actionsOf('draft', 'editor'), ['deprecate', 'promote']);
  assert.deepEqual(actionsOf('draft', 'approver'), ['deprecate', 'promote']);
  assert.deepEqual(actionsOf('draft', 'admin'), ['deprecate', 'promote']);
  // a bare team member cannot promote a draft for review — only deprecate their own team's pipeline.
  assert.deepEqual(actionsOf('draft', 'member'), ['deprecate']);
  assert.deepEqual(actionsOf('draft', 'none'), []);
});

test('in_review: ONLY approver/admin may approve; editor may withdraw but not approve', () => {
  // The sign-off gate: an editor/owner submitted it and can pull it back, but cannot self-approve.
  assert.deepEqual(actionsOf('in_review', 'editor'), ['withdraw']);
  // an approver/admin may approve or reject (and withdraw is subsumed by the higher role).
  assert.ok(actionsOf('in_review', 'approver').includes('approve'));
  assert.ok(actionsOf('in_review', 'approver').includes('reject'));
  assert.ok(actionsOf('in_review', 'admin').includes('approve'));
  // a member cannot touch a review at all.
  assert.deepEqual(actionsOf('in_review', 'member'), []);
  assert.deepEqual(actionsOf('in_review', 'none'), []);
});

test('the approve transition is the ONE gated transition and targets published', () => {
  const approve = allowedTransitions('in_review', 'approver').find((t) => t.action === 'approve');
  assert.ok(approve, 'approver sees approve from in_review');
  assert.equal(approve!.to, 'published');
  assert.equal(approve!.gated, true, 'approve runs through the release gate');
  // no other transition is gated.
  for (const status of ['draft', 'published', 'deprecated', 'archived']) {
    for (const t of allowedTransitions(status, 'admin')) {
      assert.equal(t.gated, false, `${status}/${t.action} is not gated`);
    }
  }
});

test('published: anyone with edit/member access may deprecate; member included', () => {
  assert.deepEqual(actionsOf('published', 'member'), ['deprecate']);
  assert.deepEqual(actionsOf('published', 'editor'), ['deprecate']);
  assert.deepEqual(actionsOf('published', 'admin'), ['deprecate']);
  assert.deepEqual(actionsOf('published', 'none'), []);
});

test('deprecated + legacy archived: revive to draft (editor+), member cannot revive', () => {
  assert.deepEqual(actionsOf('deprecated', 'editor'), ['revive']);
  assert.equal(transitionTarget('deprecated', 'revive'), 'draft');
  // legacy archived stays working — revivable like deprecated.
  assert.deepEqual(actionsOf('archived', 'editor'), ['revive']);
  assert.equal(transitionTarget('archived', 'revive'), 'draft');
  // a member cannot revive (revive needs editor).
  assert.deepEqual(actionsOf('deprecated', 'member'), []);
});

test('canTransition guards the exact matrix cells', () => {
  assert.equal(canTransition('draft', 'editor', 'promote'), true);
  assert.equal(canTransition('draft', 'member', 'promote'), false);
  assert.equal(canTransition('in_review', 'editor', 'approve'), false); // no self-approve
  assert.equal(canTransition('in_review', 'approver', 'approve'), true);
  assert.equal(canTransition('published', 'member', 'deprecate'), true);
  assert.equal(canTransition('published', 'none', 'deprecate'), false);
});

test('unknown / corrupt status yields no legal transitions (no illegal moves)', () => {
  assert.deepEqual(allowedTransitions('bogus', 'admin'), []);
  assert.equal(canTransition('bogus', 'admin', 'promote'), false);
  assert.equal(transitionTarget('bogus', 'promote'), null);
});

test('roleAtLeast ladder: admin ≥ approver ≥ editor ≥ member ≥ none', () => {
  assert.equal(roleAtLeast('admin', 'approver'), true);
  assert.equal(roleAtLeast('approver', 'editor'), true);
  assert.equal(roleAtLeast('editor', 'member'), true);
  assert.equal(roleAtLeast('member', 'editor'), false);
  assert.equal(roleAtLeast('none', 'member'), false);
});

test('status guards + normalisation', () => {
  assert.equal(isLifecycleStatus('in_review'), true);
  assert.equal(isLifecycleStatus('deprecated'), true);
  assert.equal(isLifecycleStatus('archived'), true);
  assert.equal(isLifecycleStatus('bogus'), false);
  // legacy statuses are unchanged; a corrupt value degrades to draft.
  assert.equal(normalizeLifecycleStatus('published'), 'published');
  assert.equal(normalizeLifecycleStatus('archived'), 'archived');
  assert.equal(normalizeLifecycleStatus('bogus'), 'draft');
  assert.equal(normalizeLifecycleStatus(undefined), 'draft');
});

test('stageInfo places statuses on the promotion track', () => {
  assert.equal(stageInfo('draft').trackIndex, 0);
  assert.equal(stageInfo('in_review').trackIndex, 1);
  assert.equal(stageInfo('published').trackIndex, 2);
  assert.equal(stageInfo('deprecated').trackIndex, -1); // off-track terminal
  assert.equal(stageInfo('archived').trackIndex, -1);
  assert.equal(stageInfo('bogus').status, 'draft'); // unknown → draft
});
