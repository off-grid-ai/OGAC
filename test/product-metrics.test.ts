import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  type MetricApp,
  type MetricRun,
  appsFromTemplates,
  appsPerPipeline,
  appsWithEvaluations,
  assembleProductMetrics,
  blockedViolations,
  failedRuns,
  governedActivityShare,
  humanApprovalShare,
  medianRunSeconds,
  pipelinesReused,
  ratio,
  runSuccessRate,
  successfulRuns,
} from '../src/lib/product-metrics.ts';

// ── §13 product success metrics ──────────────────────────────────────────────────────────────────────
//
// The §13 audit found almost every metric DERIVABLE from recorded data and almost none COMPUTED — the same
// defect class as the five boundary bugs, applied to the product's own scoreboard. This is the computation.

const run = (over: Partial<MetricRun> = {}): MetricRun => ({
  id: 'r1', status: 'done', pipelineId: 'pl_1', ...over,
});
const app = (over: Partial<MetricApp> = {}): MetricApp => ({ id: 'a1', pipelineId: 'pl_1', ...over });

describe('ratio', () => {
  test('an empty denominator is null, NOT 0% — those are different facts', () => {
    // "0% of apps have evaluations" when no apps exist is the same lie as a failed read saying "no rows".
    assert.equal(ratio(0, 0).pct, null);
    assert.equal(ratio(0, 4).pct, 0, 'a real zero IS 0%');
    assert.equal(ratio(1, 3).pct, 33);
  });

  test('always reports what it is a ratio OF', () => {
    const r = ratio(2, 8);
    assert.equal(r.numerator, 2);
    assert.equal(r.denominator, 8);
  });
});

describe('reliability', () => {
  const RUNS = [
    run({ id: '1', status: 'done' }),
    run({ id: '2', status: 'done' }),
    run({ id: '3', status: 'error' }),
    run({ id: '4', status: 'awaiting_human' }),
    run({ id: '5', status: 'running' }),
  ];

  test('a paused run has NOT failed, and is not counted as one', () => {
    assert.equal(successfulRuns(RUNS), 2);
    assert.equal(failedRuns(RUNS), 1);
  });

  test('success rate counts only runs that reached a terminal state', () => {
    // Counting a run correctly paused for an approver as a non-success would penalise the product for
    // doing the governed thing, and would drift with how promptly humans happen to review.
    const r = runSuccessRate(RUNS);
    assert.equal(r.denominator, 3, 'awaiting_human and running are excluded');
    assert.equal(r.pct, 67);
  });

  test('blocked policy decisions are counted from the ledger vocabulary', () => {
    assert.equal(
      blockedViolations([
        { action: 'pipeline.data.deny', outcome: 'blocked' },
        { action: 'app.run', outcome: 'ok' },
        { action: 'pipeline.pii.mask', outcome: 'redacted' },
        { action: 'access.denied', outcome: 'blocked' },
      ]),
      2,
      'redacted is not blocked — masking let the run proceed',
    );
  });

  test('median, not mean, so one stuck run cannot move it', () => {
    const rs = [
      run({ id: 'a', startedAt: '2026-07-30T00:00:00Z', finishedAt: '2026-07-30T00:00:10Z' }),
      run({ id: 'b', startedAt: '2026-07-30T00:00:00Z', finishedAt: '2026-07-30T00:00:20Z' }),
      run({ id: 'c', startedAt: '2026-07-30T00:00:00Z', finishedAt: '2026-07-30T10:00:00Z' }),
    ];
    assert.equal(medianRunSeconds(rs), 20);
  });

  test('no timed runs yields null rather than 0 seconds', () => {
    assert.equal(medianRunSeconds([run()]), null);
    assert.equal(medianRunSeconds([]), null);
  });
});

describe('reuse', () => {
  const APPS = [
    app({ id: '1', pipelineId: 'pl_a', templateId: 't1' }),
    app({ id: '2', pipelineId: 'pl_a' }),
    app({ id: '3', pipelineId: 'pl_b', templateId: 't1' }),
    app({ id: '4', pipelineId: null }),
  ];

  test('counts pipelines actually USED, not pipelines that exist', () => {
    assert.equal(pipelinesReused(APPS), 2);
  });

  test('template adoption is a share of all apps', () => {
    const r = appsFromTemplates(APPS);
    assert.equal(r.numerator, 2);
    assert.equal(r.denominator, 4);
    assert.equal(r.pct, 50);
  });

  test('apps per pipeline is reported per pipeline, busiest first — an average hides the skew', () => {
    assert.deepEqual(appsPerPipeline(APPS), [
      { pipelineId: 'pl_a', apps: 2 },
      { pipelineId: 'pl_b', apps: 1 },
    ]);
  });
});

describe('governance', () => {
  test('share of apps with evaluations', () => {
    assert.equal(appsWithEvaluations([app({ hasEvaluations: true }), app({ id: '2' })]).pct, 50);
  });

  test('governed activity is measured honestly — only what OGAC can see', () => {
    // Shadow AI outside the platform is not countable from inside it; claiming otherwise would be the
    // overclaim this project keeps catching.
    const r = governedActivityShare([run({ pipelineId: 'pl_1' }), run({ id: '2', pipelineId: null })]);
    assert.equal(r.pct, 50);
  });

  test('human approval share counts paused AND already-approved runs', () => {
    const runs = [
      run({ id: '1', status: 'awaiting_human' }),
      run({ id: '2', status: 'done' }),
      run({ id: '3', status: 'done' }),
    ];
    // Run 2 was approved earlier — it must not be missed just because it has since completed.
    assert.equal(humanApprovalShare(runs, new Set(['2'])).pct, 67);
  });
});

describe('assembleProductMetrics', () => {
  test('assembles every derivable group without inventing the ones that need a baseline', () => {
    const m = assembleProductMetrics(
      [run({ id: '1' }), run({ id: '2', status: 'error' })],
      [app({ hasEvaluations: true, templateId: 't1' })],
      [{ action: 'pipeline.data.deny', outcome: 'blocked' }],
      new Set(['1']),
    );
    assert.equal(m.reliability.successful, 1);
    assert.equal(m.reliability.blockedViolations, 1);
    assert.equal(m.reuse.pipelinesReused, 1);
    assert.equal(m.governance.appsWithEvaluations.pct, 100);
    // "Hours saved" and "cost per completed process" need a baseline nobody captures, so they are absent
    // rather than estimated — the same rule as not inventing a currency symbol.
    assert.ok(!('hoursSaved' in m.reliability));
    assert.deepEqual(Object.keys(m).sort(), ['governance', 'reliability', 'reuse']);
  });

  test('empty inputs produce nulls, not confident zeros', () => {
    const m = assembleProductMetrics([], [], []);
    assert.equal(m.reliability.successRate.pct, null);
    assert.equal(m.governance.appsWithEvaluations.pct, null);
    assert.equal(m.reliability.medianRunSeconds, null);
  });
});
