import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROMPT_STARTERS,
  PROMPT_STARTER_GROUPS,
  buildPromptPayload,
  groupStarters,
  searchStarters,
} from '../src/lib/prompt-starters.ts';

test('every starter has required fields and a valid group', () => {
  for (const s of PROMPT_STARTERS) {
    assert.ok(s.id, 'id');
    assert.ok(s.title, `title for ${s.id}`);
    assert.ok(s.content.trim(), `content for ${s.id}`);
    assert.ok(s.description.trim(), `description for ${s.id}`);
    assert.ok(
      (PROMPT_STARTER_GROUPS as readonly string[]).includes(s.group),
      `group for ${s.id}`,
    );
  }
});

test('ids are unique', () => {
  const ids = PROMPT_STARTERS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the named catalog entries all exist', () => {
  const ids = new Set(PROMPT_STARTERS.map((s) => s.id));
  for (const expected of [
    'summarize-and-tag',
    'extract-to-json',
    'support-reply-grounded',
    'sop-writer',
    'meeting-notes',
    'translate',
    'classify-intent',
    'redline-contract',
  ]) {
    assert.ok(ids.has(expected), `missing starter ${expected}`);
  }
});

test('buildPromptPayload mirrors the create-path shape and tags with "starter"', () => {
  const s = PROMPT_STARTERS[0];
  const payload = buildPromptPayload(s);
  assert.equal(payload.title, s.title);
  assert.equal(payload.content, s.content);
  assert.equal(payload.visibility, 'private');
  assert.ok(payload.tags.includes('starter'));
  for (const t of s.tags) assert.ok(payload.tags.includes(t.toLowerCase()));
});

test('buildPromptPayload honours org visibility and dedupes tags', () => {
  const payload = buildPromptPayload(
    {
      id: 'x',
      title: 'X',
      group: 'Summarize & extract',
      description: 'd',
      content: 'c',
      tags: ['Starter', 'starter', 'foo'],
    },
    { visibility: 'org' },
  );
  assert.equal(payload.visibility, 'org');
  assert.equal(payload.tags.filter((t) => t === 'starter').length, 1);
  assert.deepEqual(payload.tags, ['starter', 'foo']);
});

test('searchStarters matches title, tags, and content; empty returns all', () => {
  assert.equal(searchStarters([...PROMPT_STARTERS], '').length, PROMPT_STARTERS.length);
  const json = searchStarters([...PROMPT_STARTERS], 'json');
  assert.ok(json.some((s) => s.id === 'extract-to-json'));
  const none = searchStarters([...PROMPT_STARTERS], 'zzzznotarealterm');
  assert.equal(none.length, 0);
});

test('groupStarters preserves group order and drops empty groups', () => {
  const grouped = groupStarters([...PROMPT_STARTERS]);
  const order = grouped.map((g) => g.group);
  const expectedOrder = PROMPT_STARTER_GROUPS.filter((g) =>
    PROMPT_STARTERS.some((s) => s.group === g),
  );
  assert.deepEqual(order, expectedOrder);
  const total = grouped.reduce((n, g) => n + g.items.length, 0);
  assert.equal(total, PROMPT_STARTERS.length);
  for (const g of grouped) assert.ok(g.items.length > 0);
});
