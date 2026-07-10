import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeChildren, railKey } from '../src/lib/workspace-rail.ts';

// Unit tests for the pure child-normalization behind the workspace CardRail (grid-on-desktop,
// rail-on-mobile list layout for Knowledge / Projects / Prompts). Zero React, zero I/O — these lock
// the flatten + key-derivation rules the rail depends on to wrap each card without remount bugs.

test('normalizeChildren: a single node becomes a one-item array', () => {
  const node = { key: 'a' };
  assert.deepEqual(normalizeChildren(node), [node]);
});

test('normalizeChildren: flattens a nested array of nodes', () => {
  const a = { key: 'a' };
  const b = { key: 'b' };
  const c = { key: 'c' };
  assert.deepEqual(normalizeChildren([a, [b, [c]]]), [a, b, c]);
});

test('normalizeChildren: drops the values React renders as nothing', () => {
  const keep = { key: 'k' };
  // null, undefined and false are React "renders nothing"; 0 and "" are real, keep them.
  assert.deepEqual(normalizeChildren([null, keep, undefined, false, 0, '']), [keep, 0, '']);
});

test('normalizeChildren: a nullish / false top-level child yields an empty array', () => {
  assert.deepEqual(normalizeChildren(null), []);
  assert.deepEqual(normalizeChildren(undefined), []);
  assert.deepEqual(normalizeChildren(false), []);
});

test("railKey: reuses a child element's own string key", () => {
  assert.equal(railKey({ key: 'proj-42' }, 3), 'proj-42');
});

test("railKey: reuses a numeric key", () => {
  assert.equal(railKey({ key: 7 }, 3), 7);
});

test('railKey: falls back to the index when there is no usable key', () => {
  assert.equal(railKey({ key: null }, 2), 2); // present but null
  assert.equal(railKey({}, 5), 5); // no key field
  assert.equal(railKey('plain string child', 1), 1); // non-object
  assert.equal(railKey(null, 4), 4); // nullish child
  assert.equal(railKey({ key: { nested: true } }, 6), 6); // non-primitive key → index
});
