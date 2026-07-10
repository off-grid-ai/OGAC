import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type JaegerTrace,
  findRootSpan,
  shapeServices,
  shapeTraceSpans,
  shapeTraceSummary,
  shapeTraces,
} from '../src/lib/jaeger-shape.ts';

// Pure shaping of Jaeger query-API responses. No network, no mocks.

const TRACE: JaegerTrace = {
  traceID: 'abc123def456',
  processes: { p1: { serviceName: 'gateway' }, p2: { serviceName: 'chat' } },
  spans: [
    {
      spanID: 'root',
      operationName: 'POST /v1/chat',
      startTime: 1_000_000, // µs
      duration: 500_000, // 500ms
      processID: 'p1',
      references: [],
    },
    {
      spanID: 'child',
      operationName: 'llm.call',
      startTime: 1_100_000,
      duration: 200_000,
      processID: 'p2',
      references: [{ refType: 'CHILD_OF', traceID: 'abc123def456', spanID: 'root' }],
    },
  ],
};

test('findRootSpan: the span with no CHILD_OF reference', () => {
  const root = findRootSpan(TRACE.spans!);
  assert.equal(root?.spanID, 'root');
});

test('findRootSpan: no explicit root → earliest-starting span; empty → null', () => {
  const spans = [
    { spanID: 'b', startTime: 2000, references: [{ refType: 'CHILD_OF', spanID: 'a' }] },
    { spanID: 'a', startTime: 1000, references: [{ refType: 'CHILD_OF', spanID: 'b' }] },
  ];
  assert.equal(findRootSpan(spans)?.spanID, 'a');
  assert.equal(findRootSpan([]), null);
});

test('shapeTraceSummary: root op, service, full-trace duration, span count', () => {
  const s = shapeTraceSummary(TRACE);
  assert.equal(s.traceId, 'abc123def456');
  assert.equal(s.rootOperation, 'POST /v1/chat');
  assert.equal(s.service, 'gateway');
  assert.equal(s.spanCount, 2);
  // window = max end (1.3s) − min start (1.0s) = 300ms... but root runs to 1.5s → 500ms total
  assert.equal(s.durationMs, 500);
  assert.equal(s.startTimeMs, 1000);
});

test('shapeTraceSummary: tolerates missing spans/processes', () => {
  const s = shapeTraceSummary({ traceID: 't' });
  assert.equal(s.traceId, 't');
  assert.equal(s.service, 'unknown');
  assert.equal(s.rootOperation, '(unknown)');
  assert.equal(s.spanCount, 0);
  assert.equal(s.durationMs, 0);
});

test('shapeTraces: summaries newest-first; empty/malformed → []', () => {
  const older: JaegerTrace = {
    traceID: 'old',
    processes: { p: { serviceName: 's' } },
    spans: [{ spanID: 'r', startTime: 500_000, duration: 1000, processID: 'p' }],
  };
  const rows = shapeTraces({ data: [older, TRACE] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].traceId, 'abc123def456'); // newer start first
  assert.deepEqual(shapeTraces(null), []);
  assert.deepEqual(shapeTraces({ data: 'x' as unknown as [] }), []);
});

test('shapeServices: dedupe, drop empties, sort; empty → []', () => {
  assert.deepEqual(shapeServices({ data: ['b', 'a', 'b', ''] }), ['a', 'b']);
  assert.deepEqual(shapeServices(null), []);
  assert.deepEqual(shapeServices({ data: 'x' as unknown as [] }), []);
  assert.deepEqual(shapeServices({ data: [1 as unknown as string] }), []);
});

test('shapeTraceSpans: waterfall offsets/widths + depth from CHILD_OF', () => {
  const spans = shapeTraceSpans(TRACE);
  assert.equal(spans.length, 2);
  // sorted by offset: root first (offset 0)
  assert.equal(spans[0].spanId, 'root');
  assert.equal(spans[0].depth, 0);
  assert.equal(spans[0].offsetPct, 0);
  assert.equal(spans[0].durationMs, 500);
  // child starts 100ms into a 500ms window → 20%
  assert.equal(spans[1].spanId, 'child');
  assert.equal(spans[1].depth, 1);
  assert.equal(Math.round(spans[1].offsetPct), 20);
  assert.equal(spans[1].service, 'chat');
});

test('shapeTraceSpans: empty / null → [] (never throws)', () => {
  assert.deepEqual(shapeTraceSpans(null), []);
  assert.deepEqual(shapeTraceSpans({}), []);
  assert.deepEqual(shapeTraceSpans({ spans: [] }), []);
});

test('shapeTraceSpans: tolerates missing span fields (id/time/op/processID all absent)', () => {
  const spans = shapeTraceSpans({
    // no processes map, spans missing spanID/startTime/duration/operationName/processID
    spans: [{}, { operationName: 'x' }],
  });
  assert.equal(spans.length, 2);
  for (const s of spans) {
    assert.equal(s.service, 'unknown');
    assert.equal(s.depth, 0);
    assert.equal(s.widthPct, 1); // zero duration → floored
  }
  assert.equal(spans.find((s) => s.spanId === '')?.operation, '(unknown)');
});

test('shapeTraceSpans: deep nesting + shared parent exercises the depth cache', () => {
  // a → b → c, and d also CHILD_OF b (b resolved from cache on d's lookup)
  const spans = shapeTraceSpans({
    processes: { p: { serviceName: 'svc' } },
    spans: [
      { spanID: 'a', startTime: 0, duration: 4000, processID: 'p' },
      {
        spanID: 'b',
        startTime: 100,
        duration: 3000,
        references: [{ refType: 'CHILD_OF', spanID: 'a' }],
      },
      {
        spanID: 'c',
        startTime: 200,
        duration: 100,
        references: [{ refType: 'CHILD_OF', spanID: 'b' }],
      },
      {
        spanID: 'd',
        startTime: 300,
        duration: 100,
        references: [{ refType: 'CHILD_OF', spanID: 'b' }],
      },
    ],
  });
  const byId = Object.fromEntries(spans.map((s) => [s.spanId, s]));
  assert.equal(byId.a.depth, 0);
  assert.equal(byId.b.depth, 1);
  assert.equal(byId.c.depth, 2);
  assert.equal(byId.d.depth, 2); // parent b came from the cache
});

test('shapeTraceSpans: CHILD_OF ref with unknown parent id → depth 0', () => {
  const spans = shapeTraceSpans({
    spans: [
      {
        spanID: 'x',
        startTime: 0,
        duration: 10,
        references: [{ refType: 'CHILD_OF', spanID: 'ghost' }],
      },
    ],
  });
  assert.equal(spans[0].depth, 0); // parent not in the trace
});

test('shapeTraceSpans: width floored at 1% for zero-duration spans', () => {
  const spans = shapeTraceSpans({
    spans: [
      { spanID: 'a', startTime: 0, duration: 1000 },
      { spanID: 'b', startTime: 500, duration: 0 },
    ],
  });
  const b = spans.find((s) => s.spanId === 'b')!;
  assert.equal(b.widthPct, 1);
});
