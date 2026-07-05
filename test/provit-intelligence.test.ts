import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeRepos,
  normalizeIngestStatus,
  validateRepoTarget,
  parseChatFrame,
} from '../src/lib/provit-intelligence.ts';
import { canDeleteRow } from '../src/lib/provit-policy.ts';
import { provitUploadName, isProvitUploadName, displayName } from '../src/lib/provit-upload.ts';

// Unit tests for the PURE request/response shaping of the Provit intelligence + upload bridges.
// No mocks, no network — exercised against representative Provit responses (from provit/src/ui/server.ts).

// ── normalizeRepos (GET /api/repos) ─────────────────────────────────────────────────────────────
test('normalizeRepos: shapes a real Provit /api/repos entry', () => {
  const repos = normalizeRepos([
    {
      id: 'todomvc', url: 'https://github.com/tastejs/todomvc', name: 'tastejs/todomvc',
      features: 6, cases: 0, generatedCases: 24, screens: 3, hasSession: true,
      runCount: 2, latestRunId: 'r1', latestRunFlagged: 1,
    },
  ]);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].id, 'todomvc');
  // generatedCases wins over the (misleading) 0 corpus cases.
  assert.equal(repos[0].cases, 24);
  assert.equal(repos[0].features, 6);
  assert.equal(repos[0].hasSession, true);
  assert.equal(repos[0].runCount, 2);
  assert.equal(repos[0].latestRunId, 'r1');
});

test('normalizeRepos: derives name from url + tolerates counts.* shape', () => {
  const repos = normalizeRepos([
    { id: 'x', url: 'https://github.com/a/b.git', counts: { features: 2, cases: 5, screens: 1 } },
  ]);
  assert.equal(repos[0].name, 'a/b');
  assert.equal(repos[0].features, 2);
  assert.equal(repos[0].cases, 5);
  assert.equal(repos[0].screens, 1);
});

test('normalizeRepos: drops entries with no id; never throws on junk', () => {
  assert.deepEqual(normalizeRepos(null), []);
  assert.deepEqual(normalizeRepos({}), []);
  assert.deepEqual(normalizeRepos([{ url: 'no-id' }, null, 42]), []);
});

// ── normalizeIngestStatus (GET /api/ingest/status) ──────────────────────────────────────────────
test('normalizeIngestStatus: shapes a running job', () => {
  const s = normalizeIngestStatus({ running: true, phase: 'synthesize', message: 'Mapping…', error: null, repo: 'https://github.com/a/b' });
  assert.equal(s.running, true);
  assert.equal(s.phase, 'synthesize');
  assert.equal(s.error, null);
});

test('normalizeIngestStatus: unreachable → idle carrying the error', () => {
  const s = normalizeIngestStatus(null, 'provit unreachable');
  assert.equal(s.running, false);
  assert.equal(s.phase, 'error');
  assert.equal(s.error, 'provit unreachable');
});

// ── validateRepoTarget (the ONE thing Provit's HTTP intake accepts) ─────────────────────────────
test('validateRepoTarget: accepts + normalizes a public GitHub URL', () => {
  assert.deepEqual(validateRepoTarget('https://github.com/owner/repo.git/'), { url: 'https://github.com/owner/repo' });
  assert.deepEqual(validateRepoTarget('  https://github.com/a/b  '), { url: 'https://github.com/a/b' });
});

test('validateRepoTarget: rejects non-GitHub / local paths (honest — Provit only maps public URLs)', () => {
  assert.ok('error' in validateRepoTarget('/Users/me/repo'));
  assert.ok('error' in validateRepoTarget('https://gitlab.com/a/b'));
  assert.ok('error' in validateRepoTarget(''));
});

// ── parseChatFrame (SSE from /api/chat) ─────────────────────────────────────────────────────────
test('parseChatFrame: parses delta / error / done / [DONE] / keepalive', () => {
  assert.deepEqual(parseChatFrame('data: {"delta":"hi"}'), { delta: 'hi' });
  assert.deepEqual(parseChatFrame('data: {"error":"boom"}'), { error: 'boom' });
  assert.deepEqual(parseChatFrame('data: {"done":true}'), { done: true });
  assert.deepEqual(parseChatFrame('data: [DONE]'), { done: true });
  assert.equal(parseChatFrame(': keepalive'), null);
  assert.equal(parseChatFrame('data: {not json'), null);
  assert.equal(parseChatFrame(''), null);
});

// ── canDeleteRow (delete authority is stricter than visibility) ─────────────────────────────────
test('canDeleteRow: owner of private row can delete; a stranger cannot', () => {
  const row = { visibility: 'private', orgId: 'o1', ownerId: 'me@x.io' };
  assert.equal(canDeleteRow(row, { orgId: 'o1', email: 'me@x.io', isAdmin: false }), true);
  assert.equal(canDeleteRow(row, { orgId: 'o1', email: 'other@x.io', isAdmin: false }), false);
});

test('canDeleteRow: same-org member deletes an org row; other org cannot', () => {
  const row = { visibility: 'org', orgId: 'o1', ownerId: 'a@x.io' };
  assert.equal(canDeleteRow(row, { orgId: 'o1', email: 'b@x.io', isAdmin: false }), true);
  assert.equal(canDeleteRow(row, { orgId: 'o2', email: 'b@x.io', isAdmin: false }), false);
});

test('canDeleteRow: a public demo row is NOT deletable by just anyone (only its mapper or an admin)', () => {
  const row = { visibility: 'public', orgId: 'default', ownerId: 'mapper@x.io' };
  assert.equal(canDeleteRow(row, { orgId: 'default', email: 'random@x.io', isAdmin: false }), false);
  assert.equal(canDeleteRow(row, { orgId: 'default', email: 'mapper@x.io', isAdmin: false }), true);
  assert.equal(canDeleteRow(row, { orgId: 'whatever', email: 'random@x.io', isAdmin: true }), true);
});

// ── provit-upload tag convention ────────────────────────────────────────────────────────────────
test('provit-upload: tag round-trips through store/display and sanitizes paths', () => {
  const stored = provitUploadName('my repo/../x.zip');
  assert.ok(isProvitUploadName(stored));
  assert.equal(displayName(stored), 'my repo_.._x.zip');
  assert.equal(isProvitUploadName('plain-file.zip'), false);
  assert.equal(displayName('plain-file.zip'), 'plain-file.zip');
});
