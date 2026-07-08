import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildWaterfall,
  langfuseReadConfigured,
  type LangfuseObservation,
} from '@/lib/langfuse';

// Pure trace-detail helpers not reached by the existing read-back suite. buildWaterfall turns a flat
// observation list into a positioned, nested span timeline; langfuseReadConfigured is the env gate.
// No network — real functions over representative /observations JSON shapes.

const obs = (o: Partial<LangfuseObservation> & { id: string }): LangfuseObservation => ({
  traceId: 't1',
  type: 'span',
  ...o,
});

test('langfuseReadConfigured: false when no Langfuse env is present (test default)', () => {
  // The test process has no OFFGRID_LANGFUSE_* env set → read-back is not configured.
  assert.equal(langfuseReadConfigured(), false);
});

test('buildWaterfall: empty observation list → empty timeline', () => {
  assert.deepEqual(buildWaterfall([]), []);
});

test('buildWaterfall: positions spans by time offset/width against the full trace span', () => {
  const spans = buildWaterfall([
    obs({ id: 'root', startTime: '2026-01-01T00:00:00.000Z', endTime: '2026-01-01T00:00:10.000Z' }),
    obs({
      id: 'child',
      parentObservationId: 'root',
      type: 'generation',
      name: 'llm',
      model: 'gemma-local',
      startTime: '2026-01-01T00:00:05.000Z',
      endTime: '2026-01-01T00:00:10.000Z',
    }),
  ]);
  assert.equal(spans.length, 2);
  // Sorted by start time: root first.
  assert.equal(spans[0].id, 'root');
  assert.equal(spans[1].id, 'child');
  // Root spans the entire window.
  assert.equal(spans[0].offsetPct, 0);
  assert.equal(spans[0].widthPct, 100);
  assert.equal(spans[0].durationMs, 10_000);
  assert.equal(spans[0].depth, 0);
  // Child starts halfway through and is nested one level under root.
  assert.equal(spans[1].offsetPct, 50);
  assert.equal(spans[1].widthPct, 50);
  assert.equal(spans[1].depth, 1);
  // Falls back to type for the label only when name is absent; here name is set.
  assert.equal(spans[1].name, 'llm');
});

test('buildWaterfall: a missing endTime collapses to the start (zero-duration point), width floored at 1%', () => {
  const spans = buildWaterfall([
    obs({ id: 'a', startTime: '2026-01-01T00:00:00.000Z', endTime: '2026-01-01T00:00:00.100Z' }),
    obs({ id: 'b', startTime: '2026-01-01T00:00:00.100Z' }), // no endTime → end == start
  ]);
  const b = spans.find((s) => s.id === 'b')!;
  assert.equal(b.durationMs, 0);
  assert.ok(b.widthPct >= 1, 'width is floored to a visible minimum');
  // name falls back to the observation type when no name is provided.
  assert.equal(b.name, 'span');
});
