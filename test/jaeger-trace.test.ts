import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type JaegerOperationsResponse,
  type JaegerServicesResponse,
  type JaegerTracesResponse,
  type TaggedTrace,
  applyTraceFilters,
  buildTraceSearchParams,
  buildWaterfall,
  normalizeOperations,
  normalizeServices,
  normalizeTags,
  normalizeTrace,
  normalizeTraces,
  parseRange,
  rangeWindowMicros,
  spanHasError,
  traceHasError,
  traceHeadline,
} from '../src/lib/jaeger-trace.ts';

// Pure logic for the distributed-trace search surface. No network, no mocks — representative Jaeger
// query-API JSON in, typed display models out. Every branch exercised.

const NOW = 1_700_000_000_000; // fixed epoch ms

// A representative trace: gateway → chat, with an errored child.
const TRACE: TaggedTrace = {
  traceID: 'abc123',
  processes: { p1: { serviceName: 'gateway' }, p2: { serviceName: 'chat' } },
  spans: [
    {
      spanID: 'root',
      operationName: 'POST /v1/chat',
      startTime: 1_000_000,
      duration: 500_000, // 500ms
      processID: 'p1',
      references: [],
      tags: [{ key: 'http.method', value: 'POST' }],
    },
    {
      spanID: 'child',
      operationName: 'llm.call',
      startTime: 1_100_000,
      duration: 300_000, // 300ms
      processID: 'p2',
      references: [{ refType: 'CHILD_OF', spanID: 'root' }],
      tags: [{ key: 'error', value: true }],
    },
  ],
};

// ── parseRange / rangeWindowMicros ────────────────────────────────────────────────
test('parseRange accepts supported ranges and defaults the rest to 1h', () => {
  assert.equal(parseRange('15m'), '15m');
  assert.equal(parseRange('6h'), '6h');
  assert.equal(parseRange('24h'), '24h');
  assert.equal(parseRange('nonsense'), '1h');
  assert.equal(parseRange(null), '1h');
  assert.equal(parseRange(undefined), '1h');
});

test('rangeWindowMicros returns a microsecond window ending at now', () => {
  const { startUs, endUs } = rangeWindowMicros('15m', NOW);
  assert.equal(endUs, NOW * 1000);
  assert.equal(endUs - startUs, 15 * 60_000 * 1000);
});

// ── buildTraceSearchParams ────────────────────────────────────────────────────────
test('buildTraceSearchParams encodes service, window, and default limit', () => {
  const qs = buildTraceSearchParams({ service: 'gateway', nowMs: NOW });
  assert.equal(qs.get('service'), 'gateway');
  assert.equal(qs.get('limit'), '20');
  assert.equal(qs.get('end'), String(NOW * 1000));
  assert.equal(qs.has('operation'), false);
  assert.equal(qs.has('minDuration'), false);
  assert.equal(qs.has('tags'), false);
});

test('buildTraceSearchParams includes operation unless empty or "all"', () => {
  assert.equal(buildTraceSearchParams({ service: 's', operation: 'llm.call', nowMs: NOW }).get('operation'), 'llm.call');
  assert.equal(buildTraceSearchParams({ service: 's', operation: 'all', nowMs: NOW }).has('operation'), false);
  assert.equal(buildTraceSearchParams({ service: 's', operation: '  ', nowMs: NOW }).has('operation'), false);
});

test('buildTraceSearchParams encodes minDuration and error tag', () => {
  const qs = buildTraceSearchParams({ service: 's', minDurationMs: 150, errorOnly: true, nowMs: NOW });
  assert.equal(qs.get('minDuration'), '150ms');
  assert.equal(qs.get('tags'), JSON.stringify({ error: 'true' }));
});

test('buildTraceSearchParams ignores non-positive/NaN minDuration and clamps limit', () => {
  assert.equal(buildTraceSearchParams({ service: 's', minDurationMs: 0, nowMs: NOW }).has('minDuration'), false);
  assert.equal(buildTraceSearchParams({ service: 's', minDurationMs: -5, nowMs: NOW }).has('minDuration'), false);
  assert.equal(buildTraceSearchParams({ service: 's', limit: 9999, nowMs: NOW }).get('limit'), '200');
  assert.equal(buildTraceSearchParams({ service: 's', limit: 0, nowMs: NOW }).get('limit'), '1');
  assert.equal(buildTraceSearchParams({ service: 's', limit: NaN, nowMs: NOW }).get('limit'), '20');
  assert.equal(buildTraceSearchParams({ service: 's', limit: null, nowMs: NOW }).get('limit'), '20');
});

// ── spanHasError ────────────────────────────────────────────────────────────────
test('spanHasError recognizes error=true (bool and string)', () => {
  assert.equal(spanHasError({ tags: [{ key: 'error', value: true }] }), true);
  assert.equal(spanHasError({ tags: [{ key: 'ERROR', value: 'true' }] }), true);
  assert.equal(spanHasError({ tags: [{ key: 'error', value: 'false' }] }), false);
});

test('spanHasError recognizes otel status ERROR and http 5xx', () => {
  assert.equal(spanHasError({ tags: [{ key: 'otel.status_code', value: 'ERROR' }] }), true);
  assert.equal(spanHasError({ tags: [{ key: 'otel.status_code', value: 'OK' }] }), false);
  assert.equal(spanHasError({ tags: [{ key: 'http.status_code', value: 503 }] }), true);
  assert.equal(spanHasError({ tags: [{ key: 'http.response.status_code', value: '500' }] }), true);
  assert.equal(spanHasError({ tags: [{ key: 'http.status_code', value: 404 }] }), false);
  assert.equal(spanHasError({ tags: [{ key: 'http.status_code', value: 'oops' }] }), false);
});

test('spanHasError tolerates missing/odd tags', () => {
  assert.equal(spanHasError(null), false);
  assert.equal(spanHasError(undefined), false);
  assert.equal(spanHasError({}), false);
  assert.equal(spanHasError({ tags: [{ value: 'x' }, { key: 'note', value: { nested: 1 } }] }), false);
});

test('traceHasError is true when any span errors, false otherwise', () => {
  assert.equal(traceHasError(TRACE), true);
  assert.equal(traceHasError({ spans: [{ spanID: 'a', tags: [] }] }), false);
  assert.equal(traceHasError({}), false);
  assert.equal(traceHasError(null), false);
});

// ── normalizeTrace / normalizeTraces ──────────────────────────────────────────────
test('normalizeTrace produces a typed list row with real error detection', () => {
  const row = normalizeTrace(TRACE);
  assert.equal(row.traceId, 'abc123');
  assert.equal(row.rootOp, 'POST /v1/chat');
  assert.equal(row.service, 'gateway');
  assert.equal(row.spanCount, 2);
  assert.equal(row.durationMs, 500); // window: 1_000_000 → 1_500_000 µs
  assert.equal(row.hasError, true);
  assert.equal(row.startTimeMs, 1000);
});

test('normalizeTraces sorts newest-first and tolerates junk', () => {
  const res: JaegerTracesResponse = {
    data: [
      { traceID: 'old', spans: [{ spanID: 's', startTime: 500_000, duration: 1000, processID: 'p', references: [] }], processes: {} },
      TRACE,
    ],
  };
  const rows = normalizeTraces(res);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].traceId, 'abc123'); // newer startTime first
  assert.deepEqual(normalizeTraces(null), []);
  assert.deepEqual(normalizeTraces({ data: null }), []);
  assert.deepEqual(normalizeTraces({ data: 'nope' as unknown as [] }), []);
});

// ── applyTraceFilters ─────────────────────────────────────────────────────────────
test('applyTraceFilters filters by error-only and min-duration', () => {
  const rows = [
    { traceId: 'a', rootOp: 'x', service: 's', startTimeMs: 1, durationMs: 100, spanCount: 1, hasError: true },
    { traceId: 'b', rootOp: 'y', service: 's', startTimeMs: 2, durationMs: 40, spanCount: 1, hasError: false },
  ];
  assert.deepEqual(applyTraceFilters(rows, {}).map((r) => r.traceId), ['a', 'b']);
  assert.deepEqual(applyTraceFilters(rows, { errorOnly: true }).map((r) => r.traceId), ['a']);
  assert.deepEqual(applyTraceFilters(rows, { minDurationMs: 50 }).map((r) => r.traceId), ['a']);
  assert.deepEqual(applyTraceFilters(rows, { minDurationMs: 0 }).map((r) => r.traceId), ['a', 'b']);
  assert.deepEqual(applyTraceFilters(rows, { minDurationMs: null }).map((r) => r.traceId), ['a', 'b']);
});

// ── buildWaterfall ────────────────────────────────────────────────────────────────
test('buildWaterfall enriches geometry with tags + error highlight', () => {
  const spans = buildWaterfall(TRACE);
  assert.equal(spans.length, 2);
  const root = spans.find((s) => s.spanId === 'root')!;
  const child = spans.find((s) => s.spanId === 'child')!;
  assert.equal(root.offsetPct, 0);
  assert.equal(root.depth, 0);
  assert.equal(root.hasError, false);
  assert.deepEqual(root.tags, [{ key: 'http.method', value: 'POST' }]);
  assert.equal(child.depth, 1);
  assert.equal(child.hasError, true);
  assert.ok(child.offsetPct > 0);
});

test('buildWaterfall tolerates empty/nullish trace', () => {
  assert.deepEqual(buildWaterfall(null), []);
  assert.deepEqual(buildWaterfall(undefined), []);
  assert.deepEqual(buildWaterfall({ spans: [] }), []);
});

// ── normalizeTags ─────────────────────────────────────────────────────────────────
test('normalizeTags stringifies, drops empty keys, sorts', () => {
  const tags = normalizeTags([
    { key: 'zeta', value: 1 },
    { key: 'alpha', value: 'a' },
    { key: '', value: 'dropped' },
    { key: 'flag', value: true },
    { key: 'obj', value: { x: 1 } }, // non-scalar → ''
  ]);
  assert.deepEqual(tags, [
    { key: 'alpha', value: 'a' },
    { key: 'flag', value: 'true' },
    { key: 'obj', value: '' },
    { key: 'zeta', value: '1' },
  ]);
  assert.deepEqual(normalizeTags(null), []);
  assert.deepEqual(normalizeTags(undefined), []);
});

// ── traceHeadline ─────────────────────────────────────────────────────────────────
test('traceHeadline summarizes a trace for the detail view', () => {
  const h = traceHeadline(TRACE);
  assert.equal(h.traceId, 'abc123');
  assert.equal(h.rootOp, 'POST /v1/chat');
  assert.equal(h.service, 'gateway');
  assert.equal(h.durationMs, 500);
  assert.equal(h.spanCount, 2);
  assert.equal(h.hasError, true);
  const empty = traceHeadline(null);
  assert.equal(empty.traceId, '');
  assert.equal(empty.spanCount, 0);
});

// ── normalizeServices / normalizeOperations ─────────────────────────────────────
test('normalizeServices sorts, de-dupes, drops empties', () => {
  const res: JaegerServicesResponse = { data: ['gateway', 'chat', 'gateway', '', 'agent'] };
  assert.deepEqual(normalizeServices(res), ['agent', 'chat', 'gateway']);
  assert.deepEqual(normalizeServices(null), []);
});

test('normalizeOperations handles string[] and {name}[] shapes', () => {
  const strs: JaegerOperationsResponse = { data: ['b.op', 'a.op', 'b.op'] };
  assert.deepEqual(normalizeOperations(strs), ['a.op', 'b.op']);
  const objs: JaegerOperationsResponse = {
    data: [{ name: 'z.op', spanKind: 'server' }, { name: 'a.op' }, { name: '' }, {}],
  };
  assert.deepEqual(normalizeOperations(objs), ['a.op', 'z.op']);
  assert.deepEqual(normalizeOperations(null), []);
  assert.deepEqual(normalizeOperations({ data: null }), []);
  assert.deepEqual(normalizeOperations({ data: 'nope' as unknown as [] }), []);
});
