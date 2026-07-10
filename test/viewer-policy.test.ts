import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canWrite,
  isMutatingMethod,
  isViewer,
  isViewerWriteAttempt,
  redactSecretForViewer,
  SECRET_PLACEHOLDER,
  VIEWER_FORBIDDEN_BODY,
  VIEWER_ROLE,
} from '@/lib/viewer-policy';

// Pure read-only-viewer policy. ZERO IO — every arm of every predicate exercised both ways so the
// conditions/branch bar is met and the security rule is proven, not assumed.

test('isViewer: only the viewer role, case-insensitive; everything else is not a viewer', () => {
  assert.equal(isViewer('viewer'), true);
  assert.equal(isViewer('VIEWER'), true);
  assert.equal(isViewer(' Viewer '), true);
  assert.equal(isViewer('admin'), false);
  assert.equal(isViewer('operator'), false);
  assert.equal(isViewer('compliance'), false);
  assert.equal(isViewer('viewer-plus'), false);
  assert.equal(isViewer(''), false);
  assert.equal(isViewer(null), false);
  assert.equal(isViewer(undefined), false);
  assert.equal(isViewer(VIEWER_ROLE), true);
});

test('isMutatingMethod: POST/PUT/PATCH/DELETE mutate; GET/HEAD/OPTIONS do not', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete', ' patch ']) {
    assert.equal(isMutatingMethod(m), true, `${m} should be mutating`);
  }
  for (const m of ['GET', 'HEAD', 'OPTIONS', 'get', 'head', '', 'TRACE']) {
    assert.equal(isMutatingMethod(m), false, `${m} should be safe`);
  }
  assert.equal(isMutatingMethod(null), false);
  assert.equal(isMutatingMethod(undefined), false);
});

test('canWrite: false for a viewer, true for every other role (and absent role)', () => {
  assert.equal(canWrite('viewer'), false);
  assert.equal(canWrite('VIEWER'), false);
  assert.equal(canWrite('admin'), true);
  assert.equal(canWrite('operator'), true);
  assert.equal(canWrite('compliance'), true);
  assert.equal(canWrite(undefined), true); // absent role is NOT a viewer → not this rule's job to block
  assert.equal(canWrite(null), true);
});

test('isViewerWriteAttempt: true ONLY when viewer AND mutating — both arms of each condition', () => {
  // viewer + mutating → blocked
  assert.equal(isViewerWriteAttempt('viewer', 'POST'), true);
  assert.equal(isViewerWriteAttempt('viewer', 'DELETE'), true);
  // viewer + safe → allowed (read everything)
  assert.equal(isViewerWriteAttempt('viewer', 'GET'), false);
  assert.equal(isViewerWriteAttempt('viewer', 'HEAD'), false);
  // non-viewer + mutating → allowed (admin writes)
  assert.equal(isViewerWriteAttempt('admin', 'POST'), false);
  // non-viewer + safe → allowed
  assert.equal(isViewerWriteAttempt('admin', 'GET'), false);
  // missing inputs
  assert.equal(isViewerWriteAttempt(undefined, 'POST'), false);
  assert.equal(isViewerWriteAttempt('viewer', undefined), false);
});

test('redactSecretForViewer: viewer sees the placeholder for a real value, keeps empty/absent state', () => {
  // viewer: a real secret becomes the fixed placeholder — the VALUE never leaks
  assert.equal(redactSecretForViewer('sk-live-abc123', true), SECRET_PLACEHOLDER);
  assert.equal(redactSecretForViewer('any-secret', true), SECRET_PLACEHOLDER);
  assert.notEqual(redactSecretForViewer('sk-live-abc123', true), 'sk-live-abc123');
  // viewer: empty/absent stays as-is so "configured vs not" is still distinguishable
  assert.equal(redactSecretForViewer('', true), '');
  assert.equal(redactSecretForViewer(null, true), null);
  assert.equal(redactSecretForViewer(undefined, true), undefined);
  // non-viewer: value passes through untouched, both non-empty and empty
  assert.equal(redactSecretForViewer('sk-live-abc123', false), 'sk-live-abc123');
  assert.equal(redactSecretForViewer('', false), '');
  assert.equal(redactSecretForViewer(null, false), null);
});

test('VIEWER_FORBIDDEN_BODY: the 403 body names the read-only demo reason without a secret', () => {
  assert.equal(VIEWER_FORBIDDEN_BODY.error, 'forbidden');
  assert.match(VIEWER_FORBIDDEN_BODY.reason, /read-only/);
});
