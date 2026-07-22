import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type EntityTraceSource,
  type EntityWindowData,
  getEntityObservability,
  getEntityTraceDetail,
} from '../src/lib/adapters/langfuse-entity.ts';
import type { LangfuseObservation, LangfuseScore, LangfuseTrace } from '../src/lib/langfuse.ts';
import {
  filterTracesByWindow,
  modelsForObservations,
  shapeTraceDetail,
  type TraceRow,
} from '../src/lib/observability-entity.ts';

// Real tests for the per-entity Langfuse machinery: the PURE window/detail shaping, plus the adapter
// ORCHESTRATION exercised through a FAKE source (mock ONLY the external Langfuse HTTP boundary — the
// pure narrowing/rollup/detail code all runs for real). No network.

const NOW = new Date('2026-07-22T12:00:00.000Z');

const trace = (over: Partial<LangfuseTrace> & { id: string }): LangfuseTrace => ({
  name: null,
  timestamp: '2026-07-21T10:00:00.000Z',
  userId: null,
  latency: null,
  totalCost: null,
  observations: undefined,
  ...over,
});

const obs = (over: Partial<LangfuseObservation> & { id: string }): LangfuseObservation => ({
  traceId: 't',
  type: 'SPAN',
  name: null,
  startTime: '2026-07-21T10:00:00.000Z',
  endTime: '2026-07-21T10:00:01.000Z',
  parentObservationId: null,
  model: null,
  latency: null,
  ...over,
});

const score = (over: Partial<LangfuseScore> & { id: string }): LangfuseScore => ({
  name: 'faithfulness',
  value: null,
  stringValue: null,
  dataType: 'NUMERIC',
  timestamp: '2026-07-21T10:00:00.000Z',
  traceId: null,
  source: 'EVAL',
  comment: null,
  ...over,
});

// A fake Langfuse boundary — the ONLY mock. Everything downstream is the real pure code.
function fakeSource(
  data: EntityWindowData,
  observations: Record<string, LangfuseObservation[]> = {},
  configured = true,
): EntityTraceSource {
  return {
    configured: () => configured,
    fetchWindow: async () => data,
    fetchObservations: async (id) => observations[id] ?? [],
  };
}

// ─── filterTracesByWindow ─────────────────────────────────────────────────────
test('filterTracesByWindow keeps traces inside [from,to] inclusive', () => {
  const list = [
    trace({ id: 'old', timestamp: '2026-07-01T00:00:00.000Z' }),
    trace({ id: 'in', timestamp: '2026-07-21T00:00:00.000Z' }),
    trace({ id: 'future', timestamp: '2026-08-01T00:00:00.000Z' }),
  ];
  const out = filterTracesByWindow(list, '2026-07-15T00:00:00.000Z', '2026-07-22T00:00:00.000Z');
  assert.deepEqual(
    out.map((t) => t.id),
    ['in'],
  );
});

test('filterTracesByWindow keeps a trace with an unparseable/missing timestamp (honest, not dropped)', () => {
  const list = [trace({ id: 'notime', timestamp: undefined }), trace({ id: 'bad', timestamp: 'nope' })];
  const out = filterTracesByWindow(list, '2026-07-15T00:00:00.000Z', '2026-07-22T00:00:00.000Z');
  assert.deepEqual(
    out.map((t) => t.id),
    ['notime', 'bad'],
  );
});

test('filterTracesByWindow with undefined bounds is unbounded on that side', () => {
  const list = [trace({ id: 'a', timestamp: '2020-01-01T00:00:00.000Z' })];
  assert.equal(filterTracesByWindow(list, undefined, undefined).length, 1);
  assert.equal(filterTracesByWindow(list, undefined, '2019-01-01T00:00:00.000Z').length, 0);
  assert.equal(filterTracesByWindow(list, '2021-01-01T00:00:00.000Z', undefined).length, 0);
});

// ─── modelsForObservations ────────────────────────────────────────────────────
test('modelsForObservations returns distinct sorted non-blank models', () => {
  const list = [
    obs({ id: '1', model: 'qwen2.5:7b' }),
    obs({ id: '2', model: 'llama3.1:8b' }),
    obs({ id: '3', model: 'qwen2.5:7b' }),
    obs({ id: '4', model: '  ' }),
    obs({ id: '5', model: null }),
  ];
  assert.deepEqual(modelsForObservations(list), ['llama3.1:8b', 'qwen2.5:7b']);
});

test('modelsForObservations on empty is []', () => {
  assert.deepEqual(modelsForObservations([]), []);
});

// ─── shapeTraceDetail ─────────────────────────────────────────────────────────
test('shapeTraceDetail assembles header, span/generation counts, models, waterfall, scores', () => {
  const row: TraceRow = {
    id: 't1',
    name: 'claims-triage',
    userId: 'analyst@surakshalife',
    timestamp: '2026-07-21T10:00:00.000Z',
    latency: 1200,
    cost: 0.0031,
    spans: 3,
    quality: 0.88,
  };
  const observations = [
    obs({ id: 'a', type: 'SPAN', name: 'retrieve' }),
    obs({
      id: 'b',
      type: 'GENERATION',
      name: 'answer',
      model: 'qwen2.5:7b',
      parentObservationId: 'a',
    }),
  ];
  const scores = [score({ id: 's1', traceId: 't1', value: 0.88, name: 'faithfulness' })];
  const detail = shapeTraceDetail('t1', row, observations, scores);
  assert.equal(detail.id, 't1');
  assert.equal(detail.name, 'claims-triage');
  assert.equal(detail.spanCount, 2);
  assert.equal(detail.generationCount, 1);
  assert.deepEqual(detail.models, ['qwen2.5:7b']);
  assert.equal(detail.spans.length, 2);
  assert.equal(detail.scores.length, 1);
  assert.equal(detail.scores[0].name, 'faithfulness');
});

test('shapeTraceDetail with a null row still renders from observations (honest partial)', () => {
  const detail = shapeTraceDetail('t2', null, [obs({ id: 'x', type: 'GENERATION' })], []);
  assert.equal(detail.name, 't2'); // falls back to id
  assert.equal(detail.timestamp, null);
  assert.equal(detail.generationCount, 1);
});

// ─── getEntityObservability (orchestration) ────────────────────────────────────
test('getEntityObservability: unconfigured source → honest empty view', async () => {
  const src = fakeSource({ configured: false, traces: [], scores: [] }, {}, false);
  const r = await getEntityObservability({ id: 'pl_1', tags: ['pipeline:pl_1'] }, '7d', src, NOW);
  assert.equal(r.configured, false);
  assert.equal(r.range, '7d');
  assert.equal(r.view.traceCount, 0);
});

test('getEntityObservability: narrows to entity AND window, then rolls up', async () => {
  const data: EntityWindowData = {
    configured: true,
    traces: [
      trace({ id: 'runA', name: 'pipeline:pl_1', latency: 100, totalCost: 0.01 }),
      trace({ id: 'runOld', name: 'pipeline:pl_1', timestamp: '2026-01-01T00:00:00.000Z', latency: 50 }),
      trace({ id: 'other', name: 'pipeline:pl_2', latency: 999, totalCost: 9 }),
    ],
    scores: [score({ id: 's1', traceId: 'runA', value: 0.9 })],
  };
  const src = fakeSource(data);
  const r = await getEntityObservability({ id: 'pl_1', tags: ['pipeline:pl_1'] }, '7d', src, NOW);
  assert.equal(r.configured, true);
  // runOld is out of the 7d window; other belongs to a different entity → only runA remains
  assert.equal(r.view.traceCount, 1);
  assert.equal(r.view.traces[0].id, 'runA');
  assert.equal(r.view.totalCost, 0.01);
  assert.equal(r.view.quality.length, 1);
});

test('getEntityObservability: propagates a partial-fetch error string', async () => {
  const src = fakeSource({ configured: true, traces: [], scores: [], error: 'Langfuse 500' });
  const r = await getEntityObservability({ id: 'pl_1', tags: ['pipeline:pl_1'] }, undefined, src, NOW);
  assert.equal(r.error, 'Langfuse 500');
  assert.equal(r.range, '7d'); // default range
});

// ─── getEntityTraceDetail (orchestration) ──────────────────────────────────────
test('getEntityTraceDetail: unconfigured → not configured, no detail', async () => {
  const src = fakeSource({ configured: false, traces: [], scores: [] }, {}, false);
  const r = await getEntityTraceDetail({ id: 'pl_1', tags: ['pipeline:pl_1'] }, 'runA', '7d', src, NOW);
  assert.equal(r.configured, false);
  assert.equal(r.belongs, false);
  assert.equal(r.detail, null);
});

test('getEntityTraceDetail: refuses a trace that does not belong to the entity', async () => {
  const data: EntityWindowData = {
    configured: true,
    traces: [trace({ id: 'foreign', name: 'pipeline:pl_2' })],
    scores: [],
  };
  const src = fakeSource(data);
  const r = await getEntityTraceDetail({ id: 'pl_1', tags: ['pipeline:pl_1'] }, 'foreign', '7d', src, NOW);
  assert.equal(r.belongs, false);
  assert.equal(r.detail, null);
});

test('getEntityTraceDetail: shapes the detail for a trace that belongs', async () => {
  const data: EntityWindowData = {
    configured: true,
    traces: [trace({ id: 'runA', name: 'pipeline:pl_1', latency: 300, totalCost: 0.02 })],
    scores: [score({ id: 's1', traceId: 'runA', value: 0.77, name: 'faithfulness' })],
  };
  const observations = {
    runA: [
      obs({ id: 'g', traceId: 'runA', type: 'GENERATION', model: 'qwen2.5:7b' }),
    ],
  };
  const src = fakeSource(data, observations);
  const r = await getEntityTraceDetail({ id: 'pl_1', tags: ['pipeline:pl_1'] }, 'runA', '7d', src, NOW);
  assert.equal(r.belongs, true);
  assert.equal(r.detail?.id, 'runA');
  assert.equal(r.detail?.latency, 300);
  assert.equal(r.detail?.generationCount, 1);
  assert.deepEqual(r.detail?.models, ['qwen2.5:7b']);
  assert.equal(r.detail?.scores[0].value, 0.77);
});

test('getEntityTraceDetail: trace-id-set membership renders even without list metadata', async () => {
  const data: EntityWindowData = { configured: true, traces: [], scores: [] };
  const src = fakeSource(data, { runX: [obs({ id: 'z', traceId: 'runX', type: 'GENERATION' })] });
  const r = await getEntityTraceDetail({ id: 'ag_1', traceIds: ['runX'] }, 'runX', '7d', src, NOW);
  assert.equal(r.belongs, true);
  assert.equal(r.detail?.name, 'runX'); // no row metadata → falls back to id
  assert.equal(r.detail?.generationCount, 1);
});
