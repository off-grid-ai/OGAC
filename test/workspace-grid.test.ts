import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accentHue,
  initials,
  preview,
  relativeTime,
  templateVariables,
} from '../src/lib/workspace-grid.ts';

// Unit tests for the pure card-meta shaping used by the Workspace grids (Projects / Prompts /
// Artifacts / recent chats). Zero I/O, so these lock the presentation logic without React.

test('relativeTime: buckets seconds → years with a fixed "now"', () => {
  const now = Date.parse('2026-07-06T12:00:00Z');
  const at = (iso: string) => relativeTime(iso, now);
  assert.equal(at('2026-07-06T11:59:40Z'), 'just now'); // 20s
  assert.equal(at('2026-07-06T11:57:00Z'), '3m');
  assert.equal(at('2026-07-06T09:00:00Z'), '3h');
  assert.equal(at('2026-07-03T12:00:00Z'), '3d');
  assert.equal(at('2026-05-07T12:00:00Z'), '2mo');
  assert.equal(at('2025-07-06T12:00:00Z'), '1y');
});

test('relativeTime: invalid date → empty string', () => {
  assert.equal(relativeTime('not-a-date'), '');
});

test('initials: derives 1–2 letters, uppercased', () => {
  assert.equal(initials('Weekly Status Report'), 'WR');
  assert.equal(initials('marketing'), 'MA');
  assert.equal(initials('  '), '·');
  assert.equal(initials('Q3 Board Deck Prep'), 'QP');
});

test('preview: collapses whitespace and truncates with an ellipsis', () => {
  assert.equal(preview('  hello\n\n  world  '), 'hello world');
  assert.equal(preview(null), '');
  const long = 'x'.repeat(200);
  const out = preview(long, 50);
  assert.equal(out.length, 50);
  assert.ok(out.endsWith('…'));
});

test('templateVariables: extracts unique {{vars}} in first-seen order', () => {
  assert.deepEqual(
    templateVariables('Hi {{name}}, your {{topic}} for {{name}} is ready'),
    ['name', 'topic'],
  );
  assert.deepEqual(templateVariables('no vars here'), []);
  assert.deepEqual(templateVariables('{{ spaced }}'), ['spaced']);
});

test('accentHue: deterministic 0–359 for the same seed', () => {
  const a = accentHue('project-123');
  const b = accentHue('project-123');
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 360);
  // Different seeds should (almost always) differ — spot-check two distinct ids.
  assert.notEqual(accentHue('alpha'), accentHue('beta'));
});
