import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type RunRecord, summarizeRuns } from '../src/lib/agent-runs.ts';

// Unit tests for the PURE timeline/summary function — no db, no mocks. Sample run records in,
// asserted rollup out.

function run(over: Partial<RunRecord>): RunRecord {
  return {
    id: 'run_x',
    agentId: 'a',
    query: 'q',
    status: 'done',
    steps: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

test('summarizeRuns: empty input → zeroed summary, no runs', () => {
  const v = summarizeRuns([]);
  assert.deepEqual(v.runs, []);
  assert.equal(v.summary.totalRuns, 0);
  assert.equal(v.summary.totalDurationMs, 0);
  assert.equal(v.summary.avgDurationMs, 0);
  assert.deepEqual(v.summary.statusCounts, {});
  assert.deepEqual(v.summary.stepRollup, []);
});

test('summarizeRuns: per-run durations, status counts, and aggregate rollup', () => {
  const v = summarizeRuns([
    run({
      id: 'run_1',
      status: 'done',
      startedAt: '2026-01-01T00:00:00.000Z',
      steps: [
        { kind: 'policy', ms: 10 },
        { kind: 'answer', ms: 90 },
      ],
    }),
    run({
      id: 'run_2',
      status: 'blocked',
      startedAt: '2026-01-02T00:00:00.000Z',
      steps: [{ kind: 'policy', ms: 30 }],
    }),
    run({ id: 'run_3', status: 'done', startedAt: '2026-01-03T00:00:00.000Z', steps: [] }),
  ]);

  assert.equal(v.summary.totalRuns, 3);
  assert.deepEqual(v.summary.statusCounts, { done: 2, blocked: 1 });
  assert.equal(v.summary.totalDurationMs, 130);
  assert.equal(v.summary.avgDurationMs, Math.round(130 / 3));

  // Per-run rollup on the summary rows.
  const byId = Object.fromEntries(v.runs.map((r) => [r.id, r]));
  assert.equal(byId.run_1.durationMs, 100);
  assert.equal(byId.run_1.stepCount, 2);
  assert.equal(byId.run_2.durationMs, 30);
  assert.equal(byId.run_3.durationMs, 0);

  // Aggregate per-kind rollup, sorted by totalMs desc.
  assert.deepEqual(v.summary.stepRollup, [
    { kind: 'answer', count: 1, totalMs: 90 },
    { kind: 'policy', count: 2, totalMs: 40 },
  ]);
});

test('summarizeRuns: runs are ordered newest-first by startedAt', () => {
  const v = summarizeRuns([
    run({ id: 'old', startedAt: '2026-01-01T00:00:00.000Z' }),
    run({ id: 'new', startedAt: '2026-03-01T00:00:00.000Z' }),
    run({ id: 'mid', startedAt: '2026-02-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(
    v.runs.map((r) => r.id),
    ['new', 'mid', 'old'],
  );
});

test('summarizeRuns: tolerates non-finite step ms', () => {
  const v = summarizeRuns([
    run({
      id: 'r',
      steps: [{ kind: 'x', ms: Number.NaN }],
    }),
  ]);
  assert.equal(v.summary.totalDurationMs, 0);
  assert.equal(v.runs[0].durationMs, 0);
});
