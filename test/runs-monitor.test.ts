import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AgentRunSource,
  type AppRunSource,
  type ChatRunSource,
  type RunRow,
  computeDurationMs,
  describeDuration,
  filterRuns,
  fromAgentRun,
  fromAppRun,
  fromChatRun,
  isLive,
  kindLabel,
  mergeRuns,
  normalizeStatus,
  paginate,
  parseKind,
  parseStatus,
  sortRuns,
  statusLabel,
  summarizeRuns,
} from '../src/lib/runs-monitor.ts';

// Unit tests for the PURE runs-monitor aggregation/normalization — no mocks, no I/O. Covers the
// exact rules the Operations → Runs list + API depend on: status normalization across the three
// planes' vocabularies, the from* mappers (incl. the app-run step-level pause detection), merge/
// sort/filter/paginate/summarize, and the param parsers.

// ─── normalizeStatus ──────────────────────────────────────────────────────────────────────────
test('normalizeStatus: app vocabulary', () => {
  assert.equal(normalizeStatus('queued'), 'queued');
  assert.equal(normalizeStatus('running'), 'running');
  assert.equal(normalizeStatus('awaiting_human'), 'paused');
  assert.equal(normalizeStatus('done'), 'succeeded');
  assert.equal(normalizeStatus('error'), 'failed');
  assert.equal(normalizeStatus('cancelled'), 'cancelled');
});

test('normalizeStatus: agent + chat vocabularies (done/blocked/ok/redacted)', () => {
  assert.equal(normalizeStatus('ok'), 'succeeded');
  assert.equal(normalizeStatus('redacted'), 'succeeded');
  assert.equal(normalizeStatus('blocked'), 'failed');
  assert.equal(normalizeStatus('complete'), 'succeeded');
});

test('normalizeStatus: case-insensitive + trims + unknown → running (honest fallback)', () => {
  assert.equal(normalizeStatus('  DONE '), 'succeeded');
  assert.equal(normalizeStatus('Cancelled'), 'cancelled');
  assert.equal(normalizeStatus('weird-new-state'), 'running');
  assert.equal(normalizeStatus(''), 'running');
  assert.equal(normalizeStatus(null), 'running');
});

test('statusLabel / kindLabel / isLive', () => {
  assert.equal(statusLabel('paused'), 'Awaiting review');
  assert.equal(statusLabel('succeeded'), 'Succeeded');
  assert.equal(kindLabel('app'), 'App');
  assert.equal(kindLabel('chat'), 'Chat');
  assert.ok(isLive('running') && isLive('queued') && isLive('paused'));
  assert.ok(!isLive('succeeded') && !isLive('failed') && !isLive('cancelled'));
});

// ─── duration ──────────────────────────────────────────────────────────────────────────────────
test('computeDurationMs: valid window, missing end, inverted → null', () => {
  assert.equal(computeDurationMs('2026-01-01T00:00:00Z', '2026-01-01T00:00:02Z'), 2000);
  assert.equal(computeDurationMs('2026-01-01T00:00:00Z', null), null);
  assert.equal(computeDurationMs(null, '2026-01-01T00:00:02Z'), null);
  assert.equal(computeDurationMs('2026-01-01T00:00:05Z', '2026-01-01T00:00:00Z'), null);
});

test('describeDuration: ms / s / m / unknown', () => {
  assert.equal(describeDuration(340), '340ms');
  assert.equal(describeDuration(2000), '2.0s');
  assert.equal(describeDuration(90000), '1.5m');
  assert.equal(describeDuration(null), '—');
});

// ─── from* mappers ───────────────────────────────────────────────────────────────────────────────
test('fromAppRun: title fallback, key, href, duration, actor from input', () => {
  const src: AppRunSource = {
    id: 'apprun_1',
    appId: 'app_x',
    status: 'done',
    steps: [{ status: 'done' }],
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:01Z',
    title: 'Invoice triage',
    actor: 'mohammed@ex.com',
  };
  const row = fromAppRun(src);
  assert.equal(row.kind, 'app');
  assert.equal(row.key, 'app:apprun_1');
  assert.equal(row.name, 'Invoice triage');
  assert.equal(row.status, 'succeeded');
  assert.equal(row.durationMs, 1000);
  assert.equal(row.actor, 'mohammed@ex.com');
  assert.equal(row.href, '/build/apps/app_x/runs/apprun_1');
});

test('fromAppRun: title missing → appId; a step awaiting_human forces paused even if top status lags', () => {
  const row = fromAppRun({
    id: 'r',
    appId: 'app_y',
    status: 'running',
    steps: [{ status: 'done' }, { status: 'awaiting_human' }],
  });
  assert.equal(row.name, 'app_y');
  assert.equal(row.status, 'paused');
});

test('fromAppRun: a failed/cancelled top status is NOT overridden by a stale awaiting step', () => {
  const failed = fromAppRun({ id: 'r', appId: 'a', status: 'error', steps: [{ status: 'awaiting_human' }] });
  assert.equal(failed.status, 'failed');
  const cancelled = fromAppRun({ id: 'r', appId: 'a', status: 'cancelled', steps: [{ status: 'awaiting_human' }] });
  assert.equal(cancelled.status, 'cancelled');
});

test('fromAgentRun: maps to generic operations detail href, no fabricated duration', () => {
  const src: AgentRunSource = {
    id: 'run_9',
    agentId: 'tax-classifier',
    status: 'done',
    startedAt: '2026-01-02T00:00:00Z',
    finishedAt: null,
  };
  const row = fromAgentRun(src);
  assert.equal(row.kind, 'agent');
  assert.equal(row.name, 'tax-classifier');
  assert.equal(row.status, 'succeeded');
  assert.equal(row.durationMs, null);
  assert.equal(row.href, '/operations/runs/agent%3Arun_9');
});

test('fromChatRun: outcome→status, conversation name, model as pipeline', () => {
  const src: ChatRunSource = {
    runId: 'chatrun_ab',
    conversation: 'Chat conv_1',
    outcome: 'blocked',
    ts: '2026-01-03T00:00:00Z',
    actor: 'user@ex.com',
    model: 'onprem/llama',
  };
  const row = fromChatRun(src);
  assert.equal(row.kind, 'chat');
  assert.equal(row.status, 'failed');
  assert.equal(row.name, 'Chat conv_1');
  assert.equal(row.pipeline, 'onprem/llama');
  assert.equal(row.href, '/operations/runs/chat%3Achatrun_ab');
});

test('fromChatRun: blank conversation/model → sensible defaults', () => {
  const row = fromChatRun({ runId: 'c1', outcome: 'ok' });
  assert.equal(row.name, 'Chat');
  assert.equal(row.pipeline, 'chat');
  assert.equal(row.status, 'succeeded');
});

// ─── merge + sort ────────────────────────────────────────────────────────────────────────────────
test('mergeRuns: combines three planes, newest-first; null-start rows sink', () => {
  const rows = mergeRuns({
    app: [{ id: 'a', appId: 'x', status: 'done', startedAt: '2026-01-01T00:00:00Z' }],
    agent: [{ id: 'b', agentId: 'g', status: 'done', startedAt: '2026-01-03T00:00:00Z' }],
    chat: [
      { runId: 'c', outcome: 'ok', ts: '2026-01-02T00:00:00Z' },
      { runId: 'd', outcome: 'ok', ts: null },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.key),
    ['agent:b', 'chat:c', 'app:a', 'chat:d'],
  );
});

test('sortRuns: stable tiebreak by key on equal timestamps', () => {
  const mk = (key: string): RunRow => ({
    id: key,
    key,
    kind: 'app',
    name: key,
    status: 'succeeded',
    rawStatus: 'done',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: null,
    durationMs: null,
    pipeline: '',
    actor: '',
    href: '',
  });
  const sorted = sortRuns([mk('app:z'), mk('app:a'), mk('app:m')]);
  assert.deepEqual(sorted.map((r) => r.key), ['app:a', 'app:m', 'app:z']);
});

// ─── filter ──────────────────────────────────────────────────────────────────────────────────────
function sample(): RunRow[] {
  return mergeRuns({
    app: [
      { id: 'a1', appId: 'invoices', status: 'done', title: 'Invoice triage', startedAt: '2026-01-05T00:00:00Z', actor: 'anita@ex.com' },
      { id: 'a2', appId: 'invoices', status: 'awaiting_human', steps: [{ status: 'awaiting_human' }], title: 'Invoice triage', startedAt: '2026-01-04T00:00:00Z' },
    ],
    agent: [{ id: 'g1', agentId: 'kyc-check', status: 'error', startedAt: '2026-01-03T00:00:00Z' }],
    chat: [{ runId: 'ch1', outcome: 'ok', conversation: 'Chat conv_9', ts: '2026-01-02T00:00:00Z', model: 'onprem/llama' }],
  });
}

test('filterRuns: by kind', () => {
  assert.equal(filterRuns(sample(), { kind: 'agent' }).length, 1);
  assert.equal(filterRuns(sample(), { kind: 'app' }).length, 2);
  assert.equal(filterRuns(sample(), { kind: 'all' }).length, 4);
});

test('filterRuns: by status', () => {
  assert.equal(filterRuns(sample(), { status: 'failed' }).length, 1);
  assert.equal(filterRuns(sample(), { status: 'paused' }).length, 1);
  assert.equal(filterRuns(sample(), { status: 'succeeded' }).length, 2); // app done + chat ok
});

test('filterRuns: free-text q over name/pipeline/actor/id', () => {
  assert.equal(filterRuns(sample(), { q: 'invoice' }).length, 2);
  assert.equal(filterRuns(sample(), { q: 'anita' }).length, 1);
  assert.equal(filterRuns(sample(), { q: 'kyc' }).length, 1);
  assert.equal(filterRuns(sample(), { q: 'llama' }).length, 1);
  assert.equal(filterRuns(sample(), { q: 'nope' }).length, 0);
});

test('filterRuns: combined kind + status + q', () => {
  const out = filterRuns(sample(), { kind: 'app', status: 'paused', q: 'invoice' });
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'paused');
});

// ─── paginate ──────────────────────────────────────────────────────────────────────────────────
test('paginate: window, total, hasMore, and clamped/negative inputs', () => {
  const rows = Array.from({ length: 10 }, (_, i) => i);
  const p1 = paginate(rows, 0, 4);
  assert.deepEqual(p1.rows, [0, 1, 2, 3]);
  assert.equal(p1.total, 10);
  assert.equal(p1.hasMore, true);

  const p3 = paginate(rows, 8, 4);
  assert.deepEqual(p3.rows, [8, 9]);
  assert.equal(p3.hasMore, false);

  const neg = paginate(rows, -5, 0);
  assert.equal(neg.offset, 0);
  assert.equal(neg.limit, 50);
});

// ─── summarize ─────────────────────────────────────────────────────────────────────────────────
test('summarizeRuns: counts by status + kind + live', () => {
  const s = summarizeRuns(sample());
  assert.equal(s.total, 4);
  assert.equal(s.byStatus.succeeded, 2);
  assert.equal(s.byStatus.failed, 1);
  assert.equal(s.byStatus.paused, 1);
  assert.equal(s.byKind.app, 2);
  assert.equal(s.byKind.agent, 1);
  assert.equal(s.byKind.chat, 1);
  assert.equal(s.live, 1); // only the paused app run is live
});

// ─── param parsers ───────────────────────────────────────────────────────────────────────────────
test('parseKind / parseStatus: valid passthrough, invalid → all', () => {
  assert.equal(parseKind('agent'), 'agent');
  assert.equal(parseKind('bogus'), 'all');
  assert.equal(parseKind(null), 'all');
  assert.equal(parseStatus('paused'), 'paused');
  assert.equal(parseStatus('done'), 'all'); // 'done' is a raw status, not the normalized vocabulary
  assert.equal(parseStatus(undefined), 'all');
});
