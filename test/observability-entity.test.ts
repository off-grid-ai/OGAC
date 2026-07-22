import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LangfuseScore, LangfuseTrace } from '../src/lib/langfuse.ts';
import {
  type EntityMatch,
  emptyEntityObservability,
  filterScoresForTraces,
  filterTracesForEntity,
  latencyStats,
  percentile,
  rollupEntityObservability,
  scoresForTrace,
  toTraceRow,
  traceMatchesEntity,
  traceQuality,
} from '../src/lib/observability-entity.ts';

// PURE unit tests for per-entity AI-observability shaping — no network, no Langfuse. They pin the
// honest attribution rules (tag substring OR trace-id membership; empty match → nothing), the
// cost/latency/quality rollups, and the trace-detail score shaping. Real functions, no mocks.

const trace = (over: Partial<LangfuseTrace> & { id: string }): LangfuseTrace => ({
  name: null,
  timestamp: '2026-07-20T10:00:00.000Z',
  userId: null,
  latency: null,
  totalCost: null,
  observations: undefined,
  ...over,
});

const score = (over: Partial<LangfuseScore> & { id: string }): LangfuseScore => ({
  name: 'faithfulness',
  value: null,
  stringValue: null,
  dataType: 'NUMERIC',
  timestamp: '2026-07-20T10:00:00.000Z',
  traceId: null,
  source: 'EVAL',
  comment: null,
  ...over,
});

// ─── traceMatchesEntity ────────────────────────────────────────────────────────
test('trace matches by exact trace-id membership', () => {
  const m: EntityMatch = { id: 'ag_1', traceIds: ['runabc', 'rundef'] };
  assert.equal(traceMatchesEntity(trace({ id: 'runabc' }), m), true);
  assert.equal(traceMatchesEntity(trace({ id: 'runzzz' }), m), false);
});

test('trace matches by tag substring in name or userId', () => {
  const m: EntityMatch = { id: 'pl_1', tags: ['pipeline:pl_1'] };
  assert.equal(traceMatchesEntity(trace({ id: 't1', name: 'run pipeline:pl_1' }), m), true);
  assert.equal(traceMatchesEntity(trace({ id: 't2', userId: 'pipeline:pl_1' }), m), true);
  assert.equal(traceMatchesEntity(trace({ id: 't3', name: 'pipeline:pl_2' }), m), false);
});

test('empty match (no selectors) matches nothing — never the whole firehose', () => {
  const m: EntityMatch = { id: 'x' };
  assert.equal(traceMatchesEntity(trace({ id: 't', name: 'anything' }), m), false);
});

test('blank/whitespace tags are ignored', () => {
  const m: EntityMatch = { id: 'x', tags: ['  ', ''] };
  assert.equal(traceMatchesEntity(trace({ id: 't', name: 'x' }), m), false);
});

test('filterTracesForEntity preserves input order and keeps only matches', () => {
  const m: EntityMatch = { id: 'pl_1', tags: ['pipeline:pl_1'], traceIds: ['runX'] };
  const list = [
    trace({ id: 'runX' }),
    trace({ id: 'a', name: 'other' }),
    trace({ id: 'b', name: 'pipeline:pl_1 call' }),
  ];
  const out = filterTracesForEntity(list, m);
  assert.deepEqual(
    out.map((t) => t.id),
    ['runX', 'b'],
  );
});

// ─── filterScoresForTraces ─────────────────────────────────────────────────────
test('filterScoresForTraces keeps only scores whose traceId is in the set', () => {
  const scores = [
    score({ id: 's1', traceId: 'a' }),
    score({ id: 's2', traceId: 'b' }),
    score({ id: 's3', traceId: null }),
  ];
  const out = filterScoresForTraces(scores, ['a']);
  assert.deepEqual(
    out.map((s) => s.id),
    ['s1'],
  );
});

// ─── percentile ────────────────────────────────────────────────────────────────
test('percentile nearest-rank over a sample', () => {
  const v = [10, 20, 30, 40, 50];
  assert.equal(percentile(v, 50), 30);
  assert.equal(percentile(v, 95), 50);
  assert.equal(percentile(v, 0), 10);
  assert.equal(percentile(v, 100), 50);
});

test('percentile ignores NaN and returns null for empty', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([Number.NaN], 50), null);
  assert.equal(percentile([5, Number.NaN, 15], 50), 5); // nearest-rank p50 of [5,15] = 5
});

test('percentile is order-independent (sorts internally)', () => {
  assert.equal(percentile([50, 10, 30, 20, 40], 50), 30);
});

// ─── latencyStats ──────────────────────────────────────────────────────────────
test('latencyStats computes p50/p95/avg/max over traces with latency', () => {
  const traces = [
    trace({ id: '1', latency: 100 }),
    trace({ id: '2', latency: 200 }),
    trace({ id: '3', latency: 300 }),
    trace({ id: '4', latency: null }), // excluded
  ];
  const s = latencyStats(traces);
  assert.equal(s.count, 3);
  assert.equal(s.p50, 200);
  assert.equal(s.avg, 200);
  assert.equal(s.max, 300);
  assert.equal(s.p95, 300);
});

test('latencyStats on no-latency traces is honest null (not zero)', () => {
  const s = latencyStats([trace({ id: '1' }), trace({ id: '2' })]);
  assert.deepEqual(s, { count: 0, p50: null, p95: null, avg: null, max: null });
});

// ─── traceQuality ──────────────────────────────────────────────────────────────
test('traceQuality averages numeric scores for a trace, ignores non-numeric', () => {
  const scores = [
    score({ id: 's1', traceId: 't', value: 0.8 }),
    score({ id: 's2', traceId: 't', value: 0.6 }),
    score({ id: 's3', traceId: 't', value: null, stringValue: 'PASS' }),
    score({ id: 's4', traceId: 'other', value: 0.1 }),
  ];
  assert.equal(traceQuality(scores, 't'), 0.7);
});

test('traceQuality is null when a trace has no numeric scores', () => {
  assert.equal(traceQuality([score({ id: 's', traceId: 't', value: null })], 't'), null);
  assert.equal(traceQuality([], 't'), null);
});

// ─── toTraceRow ────────────────────────────────────────────────────────────────
test('toTraceRow maps fields and joins quality', () => {
  const t = trace({
    id: 't1',
    name: 'agent-run',
    userId: 'analyst@absli',
    latency: 1234,
    totalCost: 0.0021,
    observations: 5,
  });
  const row = toTraceRow(t, [score({ id: 's', traceId: 't1', value: 0.9 })]);
  assert.deepEqual(row, {
    id: 't1',
    name: 'agent-run',
    userId: 'analyst@absli',
    timestamp: '2026-07-20T10:00:00.000Z',
    latency: 1234,
    cost: 0.0021,
    spans: 5,
    quality: 0.9,
  });
});

test('toTraceRow falls back to id when name is blank', () => {
  const row = toTraceRow(trace({ id: 't2', name: '   ' }), []);
  assert.equal(row.name, 't2');
  assert.equal(row.quality, null);
});

// ─── rollupEntityObservability ──────────────────────────────────────────────────
test('rollupEntityObservability assembles the full entity view', () => {
  const traces = [
    trace({ id: 'runA', name: 'pipeline:pl_1', latency: 100, totalCost: 0.01 }),
    trace({ id: 'runB', name: 'pipeline:pl_1', latency: 300, totalCost: 0.03 }),
    trace({ id: 'other', name: 'pipeline:pl_2', latency: 999, totalCost: 9 }),
  ];
  const scores = [
    score({ id: 's1', traceId: 'runA', value: 0.9, name: 'faithfulness' }),
    score({ id: 's2', traceId: 'runB', value: 0.7, name: 'faithfulness' }),
    score({ id: 's3', traceId: 'other', value: 0.1, name: 'faithfulness' }),
  ];
  const view = rollupEntityObservability(traces, scores, { id: 'pl_1', tags: ['pipeline:pl_1'] });
  assert.equal(view.entityId, 'pl_1');
  assert.equal(view.traceCount, 2);
  assert.equal(view.totalCost, 0.04);
  assert.equal(view.avgCostPerRun, 0.02);
  assert.equal(view.latency.p50, 100); // nearest-rank p50 of [100,300] = 100
  assert.equal(view.latency.avg, 200);
  assert.equal(view.traces.length, 2);
  // quality series scoped to THIS entity only (excludes the other pipeline's 0.1 score)
  assert.equal(view.quality.length, 1);
  assert.equal(view.quality[0].name, 'faithfulness');
  assert.equal(view.quality[0].count, 2);
  assert.equal(view.quality[0].average, 0.8);
});

test('rollupEntityObservability with no matches is honest zeros/nulls', () => {
  const view = rollupEntityObservability([trace({ id: 'x', name: 'nope' })], [], {
    id: 'pl_9',
    tags: ['pipeline:pl_9'],
  });
  assert.equal(view.traceCount, 0);
  assert.equal(view.totalCost, 0);
  assert.equal(view.avgCostPerRun, null);
  assert.equal(view.latency.count, 0);
  assert.deepEqual(view.quality, []);
  assert.deepEqual(view.traces, []);
});

test('rollupEntityObservability matches by trace-id set (agent/app runs)', () => {
  const traces = [
    trace({ id: 'runnorm1', name: 'agent-run', latency: 50, totalCost: 0.005 }),
    trace({ id: 'unrelated', name: 'agent-run', latency: 5000 }),
  ];
  const view = rollupEntityObservability(traces, [], { id: 'ag_1', traceIds: ['runnorm1'] });
  assert.equal(view.traceCount, 1);
  assert.equal(view.traces[0].id, 'runnorm1');
});

// ─── emptyEntityObservability ────────────────────────────────────────────────────
test('emptyEntityObservability is a real-zero honest view', () => {
  const e = emptyEntityObservability('ag_x');
  assert.equal(e.entityId, 'ag_x');
  assert.equal(e.traceCount, 0);
  assert.equal(e.avgCostPerRun, null);
  assert.equal(e.latency.p95, null);
});

// ─── scoresForTrace ──────────────────────────────────────────────────────────────
test('scoresForTrace shapes + sorts a trace scores newest-first', () => {
  const scores = [
    score({ id: 's1', traceId: 't', name: 'faithfulness', value: 0.9, timestamp: '2026-07-20T09:00:00Z' }),
    score({
      id: 's2',
      traceId: 't',
      name: 'toxicity',
      value: null,
      stringValue: 'LOW',
      dataType: 'CATEGORICAL',
      timestamp: '2026-07-20T11:00:00Z',
      comment: 'ok',
    }),
    score({ id: 's3', traceId: 'other', value: 0.1 }),
  ];
  const out = scoresForTrace(scores, 't');
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'toxicity'); // newer first
  assert.equal(out[0].value, null);
  assert.equal(out[0].stringValue, 'LOW');
  assert.equal(out[0].comment, 'ok');
  assert.equal(out[1].name, 'faithfulness');
  assert.equal(out[1].value, 0.9);
});
