import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actionsFor,
  canCancel,
  canDelete,
  canRerun,
  canReview,
  isActionAllowed,
} from '../src/lib/agent-run-actions.ts';

// Unit tests for the PURE run-action state machine — no db, no mocks. Status in, valid actions out.

test('canCancel / canReview: only pending_review is in-flight', () => {
  assert.equal(canCancel('pending_review'), true);
  assert.equal(canReview('pending_review'), true);
  for (const s of ['done', 'denied', 'blocked', 'rejected', 'cancelled']) {
    assert.equal(canCancel(s), false, `${s} must not be cancellable`);
    assert.equal(canReview(s), false, `${s} must not be reviewable`);
  }
});

test('canDelete / canRerun: always allowed regardless of status', () => {
  for (const s of ['done', 'denied', 'blocked', 'pending_review', 'rejected', 'cancelled', 'weird']) {
    assert.equal(canDelete(s), true);
    assert.equal(canRerun(s), true);
  }
});

test('actionsFor: pending_review exposes review + cancel + rerun + delete', () => {
  assert.deepEqual(actionsFor('pending_review'), ['rerun', 'review', 'cancel', 'delete']);
});

test('actionsFor: terminal states expose only rerun + delete', () => {
  for (const s of ['done', 'denied', 'blocked', 'rejected', 'cancelled']) {
    assert.deepEqual(actionsFor(s), ['rerun', 'delete'], `actions for ${s}`);
  }
});

test('isActionAllowed: matches the per-action predicates', () => {
  assert.equal(isActionAllowed('cancel', 'pending_review'), true);
  assert.equal(isActionAllowed('cancel', 'done'), false);
  assert.equal(isActionAllowed('review', 'pending_review'), true);
  assert.equal(isActionAllowed('review', 'cancelled'), false);
  assert.equal(isActionAllowed('delete', 'done'), true);
  assert.equal(isActionAllowed('rerun', 'blocked'), true);
  // Unknown action is never allowed.
  assert.equal(isActionAllowed('nope' as never, 'done'), false);
});
