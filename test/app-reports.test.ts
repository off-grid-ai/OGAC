import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppRunView } from '../src/lib/app-runs-view.ts';
import {
  bucketByDay,
  buildReportStats,
  computeReportMetrics,
  computeThroughputPerDay,
  runCost,
  runDurationMs,
  singleRunSummary,
  stepKindBreakdown,
} from '../src/lib/app-reports.ts';

// PURE unit tests for the Phase 4B analytics rollup — no DB, no network. They pin the outcome
// counts, HITL approval/rejection classification, exception rate, throughput, duration, cost, day
// bucketing, step-kind mix, the single-run summary, and the stat-tile shaping.

function run(over: Partial<AppRunView> = {}): AppRunView {
  return {
    id: 'r1',
    appId: 'app1',
    status: 'done',
    input: {},
    steps: [],
    outcome: '',
    provenance: null,
    startedAt: '2026-07-01T00:00:00.000Z',
    finishedAt: '2026-07-01T00:00:01.000Z',
    ...over,
  };
}

test('computeReportMetrics counts run outcomes by status', () => {
  const m = computeReportMetrics([
    run({ status: 'done' }),
    run({ status: 'error' }),
    run({ status: 'cancelled' }),
    run({ status: 'running', finishedAt: null }),
    run({ status: 'awaiting_human', finishedAt: null }),
    run({ status: 'queued', finishedAt: null }),
  ]);
  assert.equal(m.totalRuns, 6);
  assert.equal(m.completed, 1);
  assert.equal(m.failed, 1);
  assert.equal(m.cancelled, 1);
  assert.equal(m.awaitingReview, 1);
  assert.equal(m.running, 2); // running + queued both count as in-flight
});

test('HITL: approvals/rejections classified from human step outcomes, prefix + case-insensitive', () => {
  const m = computeReportMetrics([
    run({
      steps: [
        { id: 's1', kind: 'human', label: 'Review', status: 'done', outcome: 'approved' },
        { id: 's2', kind: 'human', label: 'Review', status: 'done', outcome: 'Approve' },
        { id: 's3', kind: 'human', label: 'Review', status: 'done', outcome: 'REJECTED' },
        { id: 's4', kind: 'human', label: 'Review', status: 'done', outcome: 'edited' },
        { id: 's5', kind: 'agent', label: 'A', status: 'done', outcome: 'approved' }, // not human → ignored
      ],
    }),
  ]);
  assert.equal(m.approvals, 2);
  assert.equal(m.rejections, 1);
  assert.equal(Math.round(m.approvalRate * 100), 67);
});

test('approvalRate is 0 when nothing was decided', () => {
  const m = computeReportMetrics([run()]);
  assert.equal(m.approvalRate, 0);
});

test('exceptions count errored steps; exceptionRate is runs-with-an-error / total', () => {
  const m = computeReportMetrics([
    run({
      status: 'error',
      steps: [
        { id: 's1', kind: 'agent', label: 'A', status: 'error' },
        { id: 's2', kind: 'agent', label: 'B', status: 'error' },
      ],
    }),
    run({ status: 'done', steps: [{ id: 's1', kind: 'agent', label: 'A', status: 'done' }] }),
  ]);
  assert.equal(m.exceptions, 2); // two errored steps
  assert.equal(m.exceptionRate, 0.5); // one of two runs had an exception
});

test('runDurationMs: both timestamps present + ordered → ms; missing/inverted → null', () => {
  assert.equal(runDurationMs({ startedAt: '2026-07-01T00:00:00.000Z', finishedAt: '2026-07-01T00:00:02.000Z' }), 2000);
  assert.equal(runDurationMs({ startedAt: null, finishedAt: '2026-07-01T00:00:02.000Z' }), null);
  assert.equal(runDurationMs({ startedAt: '2026-07-01T00:00:05.000Z', finishedAt: '2026-07-01T00:00:02.000Z' }), null);
});

test('avgDurationMs averages only timestamped runs', () => {
  const m = computeReportMetrics([
    run({ startedAt: '2026-07-01T00:00:00.000Z', finishedAt: '2026-07-01T00:00:02.000Z' }), // 2000
    run({ startedAt: '2026-07-01T00:00:00.000Z', finishedAt: '2026-07-01T00:00:04.000Z' }), // 4000
    run({ startedAt: null, finishedAt: null }), // ignored
  ]);
  assert.equal(m.avgDurationMs, 3000);
});

test('runCost sums numeric tokens/cost from provenance + steps; absent → 0, never NaN', () => {
  const withCost = run({
    provenance: { tokens: 100, costUsd: 0.5 } as unknown as AppRunView['provenance'],
    steps: [{ id: 's1', kind: 'agent', label: 'A', status: 'done', tokens: 50, cost: 0.25 } as never],
  });
  const c = runCost(withCost);
  assert.equal(c.tokens, 150);
  assert.equal(c.usd, 0.75);

  const none = runCost(run());
  assert.equal(none.tokens, 0);
  assert.equal(none.usd, 0);
});

test('computeThroughputPerDay floors the span at one day', () => {
  // 4 runs on the same day → 4/day.
  const sameDay = [0, 1, 2, 3].map((h) =>
    run({ startedAt: `2026-07-01T0${h}:00:00.000Z` }),
  );
  assert.equal(computeThroughputPerDay(sameDay), 4);

  // 2 runs two days apart → 2 / 2 = 1/day.
  const spread = [
    run({ startedAt: '2026-07-01T00:00:00.000Z' }),
    run({ startedAt: '2026-07-03T00:00:00.000Z' }),
  ];
  assert.equal(computeThroughputPerDay(spread), 1);

  assert.equal(computeThroughputPerDay([]), 0);
});

test('bucketByDay groups by UTC day and gap-fills missing days', () => {
  const buckets = bucketByDay([
    run({ status: 'done', startedAt: '2026-07-01T10:00:00.000Z' }),
    run({ status: 'error', startedAt: '2026-07-01T12:00:00.000Z' }),
    run({ status: 'done', startedAt: '2026-07-03T09:00:00.000Z' }),
  ]);
  assert.equal(buckets.length, 3); // 07-01, 07-02 (gap-filled), 07-03
  assert.equal(buckets[0].day, '2026-07-01');
  assert.equal(buckets[0].total, 2);
  assert.equal(buckets[0].completed, 1);
  assert.equal(buckets[0].failed, 1);
  assert.equal(buckets[1].total, 0); // gap-filled empty day
  assert.equal(buckets[2].day, '2026-07-03');
  assert.equal(buckets[2].total, 1);
});

test('bucketByDay is empty when no run is dated', () => {
  assert.deepEqual(bucketByDay([run({ startedAt: null })]), []);
});

test('stepKindBreakdown counts steps by kind across runs', () => {
  const kinds = stepKindBreakdown([
    run({
      steps: [
        { id: 'a', kind: 'agent', label: 'A', status: 'done' },
        { id: 'b', kind: 'connector-query', label: 'B', status: 'done' },
      ],
    }),
    run({ steps: [{ id: 'c', kind: 'agent', label: 'C', status: 'done' }] }),
  ]);
  assert.equal(kinds.agent, 2);
  assert.equal(kinds['connector-query'], 1);
});

test('singleRunSummary rolls up one run for the report sink', () => {
  const s = singleRunSummary(
    run({
      id: 'r9',
      status: 'done',
      steps: [
        { id: 's1', kind: 'agent', label: 'A', status: 'done' },
        { id: 's2', kind: 'human', label: 'Review', status: 'done', outcome: 'approved' },
        { id: 's3', kind: 'agent', label: 'B', status: 'error' },
      ],
      provenance: { tokens: 200 } as unknown as AppRunView['provenance'],
    }),
  );
  assert.equal(s.id, 'r9');
  assert.equal(s.stepCount, 3);
  assert.equal(s.stepsDone, 2);
  assert.equal(s.stepsErrored, 1);
  assert.equal(s.humanDecisions.approvals, 1);
  assert.equal(s.humanDecisions.rejections, 0);
  assert.equal(s.tokens, 200);
  assert.equal(s.durationMs, 1000);
});

test('buildReportStats: failed tile is bad only when non-zero; approval tile shows dash when undecided', () => {
  const clean = buildReportStats(computeReportMetrics([run({ status: 'done' })]));
  const failed = clean.find((t) => t.label === 'Failed');
  assert.equal(failed?.tone, 'good'); // zero failures reads calm
  const approval = clean.find((t) => t.label === 'Approval rate');
  assert.equal(approval?.value, '—');

  const withFail = buildReportStats(computeReportMetrics([run({ status: 'error' })]));
  assert.equal(withFail.find((t) => t.label === 'Failed')?.tone, 'bad');
});

test('empty input yields all-zero metrics without dividing by zero', () => {
  const m = computeReportMetrics([]);
  assert.equal(m.totalRuns, 0);
  assert.equal(m.approvalRate, 0);
  assert.equal(m.exceptionRate, 0);
  assert.equal(m.throughputPerDay, 0);
  assert.equal(m.avgDurationMs, null);
});
