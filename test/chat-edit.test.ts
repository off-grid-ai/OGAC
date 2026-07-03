import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messagesUpToInclusive } from '../src/lib/chat-policy.ts';

// Unit tests for the edit-a-prior-user-message truncation rule — pure function, NO db, NO mocks.
// This is the decision that governs which turns survive when a user edits an earlier message and
// re-runs from that point (Phase 4.6), so a regression here directly breaks the feature.

const thread = [
  { id: 'u1', role: 'user', content: 'hi' },
  { id: 'a1', role: 'assistant', content: 'hello' },
  { id: 'u2', role: 'user', content: 'question' },
  { id: 'a2', role: 'assistant', content: 'answer' },
];

test('target in the middle drops the tail after it (inclusive)', () => {
  const out = messagesUpToInclusive(thread, 'u2');
  assert.deepEqual(out.map((m) => m.id), ['u1', 'a1', 'u2']);
});

test('target = last message keeps the whole thread', () => {
  const out = messagesUpToInclusive(thread, 'a2');
  assert.deepEqual(out.map((m) => m.id), ['u1', 'a1', 'u2', 'a2']);
});

test('target = first message keeps only that message', () => {
  const out = messagesUpToInclusive(thread, 'u1');
  assert.deepEqual(out.map((m) => m.id), ['u1']);
});

test('unknown id is a no-op (empty survivor set)', () => {
  assert.deepEqual(messagesUpToInclusive(thread, 'nope'), []);
});

test('empty list is empty regardless of id', () => {
  assert.deepEqual(messagesUpToInclusive([], 'u1'), []);
});

test('preserves original order and does not mutate the input', () => {
  const snapshot = thread.map((m) => m.id);
  const out = messagesUpToInclusive(thread, 'u2');
  // Survivors are in the same relative order as the source.
  assert.deepEqual(out.map((m) => m.id), ['u1', 'a1', 'u2']);
  // Source untouched.
  assert.deepEqual(thread.map((m) => m.id), snapshot);
});
