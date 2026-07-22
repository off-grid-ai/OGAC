import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DriftRun } from '../src/lib/drift-runs.ts';
import {
  DEFAULT_DRIFT_THRESHOLD,
  buildTrendSeries,
  normalizeReportHistory,
  projectSignal,
  validateDriftProject,
} from '../src/lib/evidently-monitoring.ts';

// PURE monitoring-SoR logic under test — project validation, report-history normalization, trend
// shaping + breach detection. No I/O; real fixtures modeled on retained drift_runs rows.

function run(over: Partial<DriftRun> & { startedAt: string; driftShare: number | null }): DriftRun {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    orgId: 'default',
    engine: 'evidently',
    status: 'stable',
    baseline: 20,
    current: 20,
    attribution: null,
    ...over,
  };
}

// ─── validateDriftProject ─────────────────────────────────────────────────────────────────────────
test('validateDriftProject: trims + defaults threshold when omitted', () => {
  const v = validateDriftProject({ name: '  Fraud model  ', dataset: '  txns  ' });
  assert.equal(v.ok, true);
  assert.equal(v.value!.name, 'Fraud model');
  assert.equal(v.value!.dataset, 'txns');
  assert.equal(v.value!.description, '');
  assert.equal(v.value!.driftThreshold, DEFAULT_DRIFT_THRESHOLD);
});

test('validateDriftProject: name required', () => {
  const v = validateDriftProject({ name: '   ' });
  assert.equal(v.ok, false);
  assert.equal(v.value, null);
  assert.ok(v.errors.some((e) => e.includes('name is required')));
});

test('validateDriftProject: over-long name/description/dataset each rejected', () => {
  const long = 'x'.repeat(5000);
  const v = validateDriftProject({ name: long, description: long, dataset: long });
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 3);
});

test('validateDriftProject: threshold must be a number in [0,1]', () => {
  assert.equal(validateDriftProject({ name: 'p', driftThreshold: 1.5 }).ok, false);
  assert.equal(validateDriftProject({ name: 'p', driftThreshold: -0.1 }).ok, false);
  assert.equal(validateDriftProject({ name: 'p', driftThreshold: 'abc' }).ok, false);
  const ok = validateDriftProject({ name: 'p', driftThreshold: 0.4 });
  assert.equal(ok.ok, true);
  assert.equal(ok.value!.driftThreshold, 0.4);
});

test('validateDriftProject: threshold as numeric string is coerced; 0 is valid', () => {
  const v = validateDriftProject({ name: 'p', driftThreshold: '0' });
  assert.equal(v.ok, true);
  assert.equal(v.value!.driftThreshold, 0);
});

test('validateDriftProject: null threshold falls back to default', () => {
  const v = validateDriftProject({ name: 'p', driftThreshold: null });
  assert.equal(v.value!.driftThreshold, DEFAULT_DRIFT_THRESHOLD);
});

// ─── normalizeReportHistory ────────────────────────────────────────────────────────────────────────
test('normalizeReportHistory: newest-first, derives pct + engine label from attribution', () => {
  const runs: DriftRun[] = [
    run({ startedAt: '2026-07-01T10:00:00.000Z', driftShare: 0.1 }),
    run({
      startedAt: '2026-07-03T10:00:00.000Z',
      driftShare: 0.4,
      status: 'drift',
      attribution: {
        engine: 'evidently',
        engineProven: true,
        evidentlyVersion: '0.4.40',
        driftShare: 0.4,
        status: 'drift',
        method: 'DataDriftPreset',
        baseline: 20,
        current: 20,
        fallbackReason: null,
        note: 'ran',
      },
    }),
  ];
  const h = normalizeReportHistory(runs);
  assert.equal(h[0].startedAt, '2026-07-03T10:00:00.000Z');
  assert.equal(h[0].engineProven, true);
  assert.equal(h[0].engineLabel, 'Evidently');
  assert.equal(h[0].driftPct, 40);
  assert.equal(h[0].method, 'DataDriftPreset');
  // Second run has no attribution blob → falls back to row columns, not proven.
  assert.equal(h[1].engineProven, false);
  assert.equal(h[1].driftPct, 10);
});

test('normalizeReportHistory: null drift share → null pct; native engine label fallback', () => {
  const h = normalizeReportHistory([
    run({ startedAt: '2026-07-01T00:00:00.000Z', driftShare: null, engine: 'native' }),
  ]);
  assert.equal(h[0].driftShare, null);
  assert.equal(h[0].driftPct, null);
  assert.equal(h[0].engineLabel, 'Off Grid PSI');
});

test('normalizeReportHistory: equal timestamps keep both entries (stable compare)', () => {
  const h = normalizeReportHistory([
    run({ startedAt: '2026-07-01T00:00:00.000Z', driftShare: 0.2 }),
    run({ startedAt: '2026-07-01T00:00:00.000Z', driftShare: 0.3 }),
  ]);
  assert.equal(h.length, 2);
});

// ─── buildTrendSeries ──────────────────────────────────────────────────────────────────────────────
test('buildTrendSeries: buckets by day, means share, flags breaches, direction up', () => {
  const runs: DriftRun[] = [
    run({ startedAt: '2026-07-01T09:00:00.000Z', driftShare: 0.1 }),
    run({ startedAt: '2026-07-01T18:00:00.000Z', driftShare: 0.3 }), // same day → mean 0.2
    run({ startedAt: '2026-07-05T09:00:00.000Z', driftShare: 0.5, status: 'drift' }),
  ];
  const s = buildTrendSeries(runs, { threshold: 0.25 });
  assert.equal(s.points.length, 2);
  assert.equal(s.points[0].bucket, '2026-07-01');
  assert.equal(s.points[0].driftShare, 0.2);
  assert.equal(s.points[0].runs, 2);
  assert.equal(s.points[0].breach, false);
  assert.equal(s.points[1].breach, true);
  assert.equal(s.points[1].status, 'drift');
  assert.equal(s.breaches, 1);
  assert.equal(s.latestBreachAt, '2026-07-05');
  assert.equal(s.direction, 'up');
  assert.equal(s.peak, 0.5);
  assert.equal(s.peakPct, 50);
});

test('buildTrendSeries: hourly granularity keys by hour', () => {
  const s = buildTrendSeries(
    [
      run({ startedAt: '2026-07-01T09:15:00.000Z', driftShare: 0.2 }),
      run({ startedAt: '2026-07-01T10:15:00.000Z', driftShare: 0.4 }),
    ],
    { granularity: 'hour' },
  );
  assert.equal(s.points.length, 2);
  assert.equal(s.points[0].bucket, '2026-07-01T09');
});

test('buildTrendSeries: skips null/non-finite drift shares', () => {
  const s = buildTrendSeries([
    run({ startedAt: '2026-07-01T09:00:00.000Z', driftShare: null }),
    run({ startedAt: '2026-07-02T09:00:00.000Z', driftShare: Number.NaN }),
    run({ startedAt: '2026-07-03T09:00:00.000Z', driftShare: 0.3 }),
  ]);
  assert.equal(s.points.length, 1);
});

test('buildTrendSeries: default threshold when opts omitted', () => {
  const s = buildTrendSeries([run({ startedAt: '2026-07-01T09:00:00.000Z', driftShare: 0.3 })]);
  assert.equal(s.threshold, DEFAULT_DRIFT_THRESHOLD);
  assert.equal(s.points[0].breach, true); // 0.3 ≥ 0.25
});

test('buildTrendSeries: empty runs → flat, no breaches, zero peak', () => {
  const s = buildTrendSeries([]);
  assert.deepEqual(s.points, []);
  assert.equal(s.direction, 'flat');
  assert.equal(s.breaches, 0);
  assert.equal(s.peak, 0);
  assert.equal(s.latestBreachAt, null);
});

test('buildTrendSeries: direction down when last bucket lower than first', () => {
  const s = buildTrendSeries([
    run({ startedAt: '2026-07-01T09:00:00.000Z', driftShare: 0.6 }),
    run({ startedAt: '2026-07-05T09:00:00.000Z', driftShare: 0.1 }),
  ]);
  assert.equal(s.direction, 'down');
});

test('buildTrendSeries: direction flat when within epsilon', () => {
  const s = buildTrendSeries([
    run({ startedAt: '2026-07-01T09:00:00.000Z', driftShare: 0.2 }),
    run({ startedAt: '2026-07-05T09:00:00.000Z', driftShare: 0.205 }),
  ]);
  assert.equal(s.direction, 'flat');
});

// ─── projectSignal ─────────────────────────────────────────────────────────────────────────────────
test('projectSignal: composes history + trend for a list row', () => {
  const runs: DriftRun[] = [
    run({ startedAt: '2026-07-01T09:00:00.000Z', driftShare: 0.1 }),
    run({ startedAt: '2026-07-05T09:00:00.000Z', driftShare: 0.5, status: 'drift' }),
  ];
  const sig = projectSignal(0.25, runs);
  assert.equal(sig.reportCount, 2);
  assert.equal(sig.latest!.startedAt, '2026-07-05T09:00:00.000Z');
  assert.equal(sig.direction, 'up');
  assert.equal(sig.breaches, 1);
  assert.equal(sig.peakPct, 50);
});

test('projectSignal: no runs → empty summary', () => {
  const sig = projectSignal(0.25, []);
  assert.equal(sig.reportCount, 0);
  assert.equal(sig.latest, null);
  assert.equal(sig.breaches, 0);
});
