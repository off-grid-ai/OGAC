import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_RANGE,
  type LangfuseDailyMetric,
  type LangfuseScore,
  resolveRange,
  shapeCostSummary,
  shapeScoreTrends,
} from '../src/lib/langfuse.ts';

// Pure shaping of Langfuse public-API responses. No network, no mocks — real functions fed
// representative JSON copied from the Langfuse public API shapes (/metrics/daily, /scores).

// ── shapeCostSummary (GET /api/public/metrics/daily) ──────────────────────────
const DAILY_JSON: LangfuseDailyMetric[] = [
  {
    date: '2026-07-02',
    countTraces: 10,
    countObservations: 25,
    totalCost: 1.5,
    usage: [
      { model: 'gpt-4o', inputUsage: 1000, outputUsage: 500, totalUsage: 1500, totalCost: 1.2 },
      { model: 'text-embedding-3', totalUsage: 800, totalCost: 0.3 },
    ],
  },
  {
    date: '2026-07-01',
    countTraces: 4,
    totalCost: 0.5,
    usage: [{ model: 'gpt-4o', inputUsage: 400, outputUsage: 100, totalCost: 0.5 }],
  },
  // Trace-only day: no usage array at all.
  { date: '2026-07-03', countTraces: 2, totalCost: 0 },
];

test('shapeCostSummary: totals across days + per-model rollup', () => {
  const s = shapeCostSummary(DAILY_JSON);
  assert.equal(s.totalCost, 2); // 1.5 + 0.5 + 0
  assert.equal(s.totalTraces, 16); // 10 + 4 + 2
  // gpt-4o: 1500 + (400+100 via input/output fallback) = 2000; embedding: 800
  assert.equal(s.totalTokens, 2800);
});

test('shapeCostSummary: daily series is ordered oldest→newest', () => {
  const s = shapeCostSummary(DAILY_JSON);
  assert.deepEqual(
    s.daily.map((d) => d.day),
    ['2026-07-01', '2026-07-02', '2026-07-03'],
  );
});

test('shapeCostSummary: byModel sorted by cost desc, tokens summed', () => {
  const s = shapeCostSummary(DAILY_JSON);
  assert.equal(s.byModel[0].model, 'gpt-4o');
  assert.equal(s.byModel[0].cost, 1.7); // 1.2 + 0.5
  assert.equal(s.byModel[0].tokens, 2000); // 1500 + 500
  assert.equal(s.byModel[1].model, 'text-embedding-3');
});

test('shapeCostSummary: empty input yields real zeros, not throw', () => {
  const s = shapeCostSummary([]);
  assert.deepEqual(s, {
    totalCost: 0,
    totalTokens: 0,
    totalTraces: 0,
    daily: [],
    byModel: [],
  });
});

test('shapeCostSummary: unknown model + null cost tolerated', () => {
  const s = shapeCostSummary([
    { date: '2026-07-01', countTraces: 1, totalCost: null, usage: [{ totalUsage: 100 }] },
  ]);
  assert.equal(s.byModel[0].model, 'unknown');
  assert.equal(s.totalCost, 0);
  assert.equal(s.totalTokens, 100);
});

// ── shapeScoreTrends (GET /api/public/scores) ─────────────────────────────────
const SCORES_JSON: LangfuseScore[] = [
  { id: 's1', name: 'faithfulness', value: 0.8, dataType: 'NUMERIC', timestamp: '2026-07-01T10:00:00Z', traceId: 't1' },
  { id: 's2', name: 'faithfulness', value: 0.9, dataType: 'NUMERIC', timestamp: '2026-07-03T10:00:00Z', traceId: 't2' },
  { id: 's3', name: 'faithfulness', value: 0.7, dataType: 'NUMERIC', timestamp: '2026-07-02T10:00:00Z', traceId: 't3' },
  { id: 's4', name: 'toxicity', value: 0.1, dataType: 'NUMERIC', timestamp: '2026-07-01T11:00:00Z', traceId: 't1' },
  // Categorical score — excluded from numeric trend.
  { id: 's5', name: 'sentiment', stringValue: 'positive', dataType: 'CATEGORICAL', timestamp: '2026-07-01T11:00:00Z', traceId: 't1' },
];

test('shapeScoreTrends: groups by name, orders points oldest→newest', () => {
  const t = shapeScoreTrends(SCORES_JSON);
  const faith = t.find((s) => s.name === 'faithfulness');
  assert.ok(faith);
  assert.deepEqual(
    faith.points.map((p) => p.ts),
    ['2026-07-01T10:00:00Z', '2026-07-02T10:00:00Z', '2026-07-03T10:00:00Z'],
  );
  assert.equal(faith.latest, 0.9);
  assert.equal(faith.average, 0.8); // (0.8+0.7+0.9)/3
  assert.equal(faith.count, 3);
});

test('shapeScoreTrends: excludes non-numeric scores', () => {
  const t = shapeScoreTrends(SCORES_JSON);
  assert.equal(t.find((s) => s.name === 'sentiment'), undefined);
});

test('shapeScoreTrends: series sorted by sample count desc', () => {
  const t = shapeScoreTrends(SCORES_JSON);
  assert.equal(t[0].name, 'faithfulness'); // 3 points
  assert.equal(t[1].name, 'toxicity'); // 1 point
});

test('shapeScoreTrends: empty input yields empty array', () => {
  assert.deepEqual(shapeScoreTrends([]), []);
});

// ── resolveRange (URL-driven time window) ─────────────────────────────────────
const NOW = new Date('2026-07-08T00:00:00Z');

test('resolveRange: known token maps to day count + ISO window', () => {
  const r = resolveRange('30d', NOW);
  assert.equal(r.range, '30d');
  assert.equal(r.days, 30);
  assert.equal(r.toIso, '2026-07-08T00:00:00.000Z');
  assert.equal(r.fromIso, '2026-06-08T00:00:00.000Z');
});

test('resolveRange: unknown/undefined token falls back to default', () => {
  assert.equal(resolveRange(undefined, NOW).range, DEFAULT_RANGE);
  assert.equal(resolveRange('bogus', NOW).range, DEFAULT_RANGE);
  assert.equal(resolveRange('7d', NOW).days, 7);
});
