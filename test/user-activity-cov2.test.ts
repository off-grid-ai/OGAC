import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeAgentRunRows,
  normalizeAppRunRows,
  normalizeChatRows,
  mergeActivity,
} from '../src/lib/user-activity.ts';

// Cover the agent-run / app-run / chat normalizers + their fallback arms (lines 200-235, 308-375),
// which the existing test did not reach.

test('normalizeAgentRunRows: named vs anonymous agent, and skips rows with no ts', () => {
  const out = normalizeAgentRunRows([
    { id: 'ar1', agentId: 'triage', query: 'help', status: 'ok', model: 'gemma-local', ts: '2026-07-04T10:00:00Z' },
    { id: 'ar2', agentId: '', query: null, status: 'ok', ts: '2026-07-04T11:00:00Z' },
    { id: 'skip', ts: '' }, // no ts → dropped
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].summary, 'Ran agent triage');
  assert.equal(out[0].resource, 'agent:triage');
  assert.equal(out[1].summary, 'Ran an agent');
  assert.equal(out[1].resource, '');
});

test('normalizeAgentRunRows: verdict derived from checks (blocked wins over redacted)', () => {
  const [blocked] = normalizeAgentRunRows([
    { id: 'b', agentId: 'a', status: 'ok', ts: '2026-07-04T10:00:00Z', checks: [{ verdict: 'redacted' }, { verdict: 'blocked' }] },
  ]);
  assert.equal(blocked.verdict, 'blocked');

  const [redacted] = normalizeAgentRunRows([
    { id: 'r', agentId: 'a', status: 'ok', ts: '2026-07-04T10:00:00Z', checks: [{ verdict: 'masked' }] },
  ]);
  assert.equal(redacted.verdict, 'redacted');

  // no checks array → falls back to status
  const [plain] = normalizeAgentRunRows([{ id: 'p', agentId: 'a', status: 'error', ts: '2026-07-04T10:00:00Z' }]);
  assert.equal(plain.verdict, 'error');
});

test('normalizeAgentRunRows: synthesizes an id when none is provided', () => {
  const [row] = normalizeAgentRunRows([{ agentId: 'a', status: 'ok', ts: '2026-07-04T10:00:00Z' }]);
  assert.match(row.id, /^agent-run:/);
});

test('normalizeAppRunRows: input snippet handles objects, nulls, primitives; named vs anon app', () => {
  const [named] = normalizeAppRunRows([
    { id: 'app1', appId: 'reimb', status: 'ok', ts: '2026-07-04T10:00:00Z', input: { amount: 100, meta: { a: 1 }, empty: null } },
  ]);
  assert.equal(named.summary, 'Ran app reimb');
  assert.equal(named.resource, 'app:reimb');
  assert.match(named.content, /amount: 100/);
  assert.match(named.content, /meta: \{"a":1\}/);
  assert.doesNotMatch(named.content, /empty/); // null dropped

  const [anon] = normalizeAppRunRows([{ appId: '', status: 'ok', ts: '2026-07-04T11:00:00Z', input: null }]);
  assert.equal(anon.summary, 'Ran an app');
  assert.equal(anon.content, '');
  assert.match(anon.id, /^app-run:/);
});

test('normalizeAppRunRows: drops rows without a timestamp', () => {
  assert.equal(normalizeAppRunRows([{ appId: 'x', status: 'ok' }]).length, 0);
});

test('mergeActivity dedupes by runId across audit + content sources', () => {
  const merged = mergeActivity({
    audit: [{ id: 'a', ts: '2026-07-04T10:00:00Z', action: 'agent.run', outcome: 'blocked', runId: 'shared', actor: 'u' }],
    chat: [],
    agentRuns: [{ id: 'shared', agentId: 'triage', query: 'q', status: 'ok', ts: '2026-07-04T10:00:00Z' }],
    appRuns: [],
  } as never);
  const shared = merged.filter((m) => m.runId === 'shared');
  assert.equal(shared.length, 1, 'the audit event and agent-run row merge into one item');
  // audit verdict (blocked) wins over the content row's status (ok)
  assert.equal(shared[0].verdict, 'blocked');
  // content query text is kept
  assert.match(shared[0].content, /q/);
});

test('mergeActivity: audit-only governance action with no content counterpart stands alone', () => {
  const merged = mergeActivity({
    audit: [{ id: 'g1', ts: '2026-07-04T12:00:00Z', action: 'secret.write', outcome: 'ok', actor: 'u' }],
    chat: [],
    agentRuns: [],
    appRuns: [],
  } as never);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].action, 'secret.write');
});
