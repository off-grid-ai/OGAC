import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  selectionFromParams,
  selectionToPath,
  selectionEquals,
  type ChatSelection,
} from '../src/lib/chat-nav.ts';

// Unit tests for the chat URL <-> selection mapping — pure functions, NO React, NO router, NO mocks.
// This is the decision that keeps the active conversation/project in the URL (shareable, refresh-safe,
// Back-coherent), so a regression here directly reintroduces the nav-in-useState bug.

test('selectionFromParams: both segment + project param', () => {
  const s = selectionFromParams({ conversationId: 'c1', project: 'p1' });
  assert.deepEqual(s, { conversationId: 'c1', projectId: 'p1' });
});

test('selectionFromParams: no params = new-chat landing (both null)', () => {
  assert.deepEqual(selectionFromParams({}), { conversationId: null, projectId: null });
});

test('selectionFromParams: conversation only, no project', () => {
  const s = selectionFromParams({ conversationId: 'c1' });
  assert.deepEqual(s, { conversationId: 'c1', projectId: null });
});

test('selectionFromParams: project only (All-chats new-chat under a project)', () => {
  const s = selectionFromParams({ project: 'p1' });
  assert.deepEqual(s, { conversationId: null, projectId: 'p1' });
});

test('selectionFromParams: array param values take the first element', () => {
  const s = selectionFromParams({ conversationId: ['c1', 'c2'], project: ['p1'] });
  assert.deepEqual(s, { conversationId: 'c1', projectId: 'p1' });
});

test('selectionFromParams: blank/whitespace params normalize to null', () => {
  const s = selectionFromParams({ conversationId: '  ', project: '' });
  assert.deepEqual(s, { conversationId: null, projectId: null });
});

test('selectionToPath: conversation + project', () => {
  assert.equal(
    selectionToPath({ conversationId: 'c1', projectId: 'p1' }),
    '/chat/c1?project=p1',
  );
});

test('selectionToPath: no conversation, no project = /chat', () => {
  assert.equal(selectionToPath({ conversationId: null, projectId: null }), '/chat');
});

test('selectionToPath: conversation only', () => {
  assert.equal(selectionToPath({ conversationId: 'c1', projectId: null }), '/chat/c1');
});

test('selectionToPath: project only (new chat under a project)', () => {
  assert.equal(selectionToPath({ conversationId: null, projectId: 'p1' }), '/chat?project=p1');
});

test('selectionToPath: encodes ids with URL-unsafe characters', () => {
  assert.equal(
    selectionToPath({ conversationId: 'a b/c', projectId: 'x&y' }),
    '/chat/a%20b%2Fc?project=x%26y',
  );
});

test('round-trip: params -> selection -> path decodes back to the same selection', () => {
  const original: ChatSelection = { conversationId: 'a b/c', projectId: 'x&y' };
  const path = selectionToPath(original);
  // Simulate Next decoding the path segment + query back into params.
  const [seg, query] = path.replace(/^\/chat\/?/, '').split('?');
  const project = query ? new URLSearchParams(query).get('project') : null;
  const back = selectionFromParams({
    conversationId: seg ? decodeURIComponent(seg) : null,
    project,
  });
  assert.deepEqual(back, original);
});

test('selectionEquals: same place is equal, different place is not', () => {
  assert.ok(selectionEquals({ conversationId: 'c1', projectId: 'p1' }, { conversationId: 'c1', projectId: 'p1' }));
  assert.ok(!selectionEquals({ conversationId: 'c1', projectId: null }, { conversationId: 'c2', projectId: null }));
  assert.ok(!selectionEquals({ conversationId: 'c1', projectId: 'p1' }, { conversationId: 'c1', projectId: null }));
  assert.ok(selectionEquals({ conversationId: null, projectId: null }, { conversationId: null, projectId: null }));
});
