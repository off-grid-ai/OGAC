import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  entityLabel,
  failureMessage,
  toggleMessage,
  updatedMessage,
} from '../src/lib/toast-messages.ts';

// PURE unit tests for console toast-message formatting — no DB, no network, no React.
// These pin the exact human strings shown on every toggle/save/mutation so the
// founder's "no feedback" complaint stays fixed: success reads "<X> enabled" etc.

test('entityLabel trims and falls back when empty', () => {
  assert.equal(entityLabel('  PII masking  '), 'PII masking');
  assert.equal(entityLabel(''), 'Setting');
  assert.equal(entityLabel(null), 'Setting');
  assert.equal(entityLabel(undefined, 'Flag'), 'Flag');
});

test('toggleMessage reads enabled/disabled', () => {
  assert.equal(toggleMessage('Rate limiting', true), 'Rate limiting enabled');
  assert.equal(toggleMessage('Rate limiting', false), 'Rate limiting disabled');
  assert.equal(toggleMessage('', true, 'Flag'), 'Flag enabled');
});

test('updatedMessage reads updated', () => {
  assert.equal(updatedMessage('Budget'), 'Budget updated');
  assert.equal(updatedMessage(null, 'Config'), 'Config updated');
});

test('failureMessage prefers server reason', () => {
  assert.equal(failureMessage('Quota exceeded'), 'Quota exceeded');
  assert.equal(failureMessage('  spaced  '), 'spaced');
});

test('failureMessage falls back to verb + optional subject', () => {
  assert.equal(failureMessage(null), 'Failed to update');
  assert.equal(failureMessage('', 'toggle'), 'Failed to toggle');
  assert.equal(failureMessage(undefined, 'delete', 'rule'), 'Failed to delete rule');
});
