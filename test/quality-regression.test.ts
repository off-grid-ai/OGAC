import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OnlineScore } from '../src/lib/qa/online-scores.ts';
import {
  detectQualityRegression,
  regressedSubjects,
  type QualityRegressionView,
} from '../src/lib/qa/quality-regression.ts';

// Build a verdict. `n` orders them in time (higher n = newer), so a test reads as a timeline.
const score = (
  n: number,
  quality: number,
  faithfulness = quality,
  over: Partial<OnlineScore> = {},
): OnlineScore => ({
  runId: `run_${n}`,
  orgId: 'default',
  subjectId: 'agent_a',
  quality,
  faithfulness,
  judged: true,
  reasoning: '',
  ts: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
  ...over,
});

/** n verdicts at a fixed score, occupying timeline slots [from, from+n). */
const run = (from: number, n: number, q: number, f = q, over: Partial<OnlineScore> = {}) =>
  Array.from({ length: n }, (_, i) => score(from + i, q, f, over));

test('a real drop in answer quality is reported as a regression, in plain language', () => {
  // 6 good runs, then 6 bad ones. Newest-6 is the recent window.
  const scores = [...run(0, 6, 0.9), ...run(6, 6, 0.5)];
  const [v] = detectQualityRegression(scores, { recentSize: 6, minSamples: 5 });

  assert.equal(v.status, 'regressed');
  assert.deepEqual(v.dimensions, ['quality', 'faithfulness']);
  assert.equal(v.recentQuality, 0.5);
  assert.equal(v.baselineQuality, 0.9);
  assert.equal(v.recentCount, 6);
  assert.equal(v.baselineCount, 6);
  assert.match(v.detail, /getting worse/);
  assert.match(v.detail, /quality fell from 0\.9 to 0\.5/);
  assert.deepEqual(regressedSubjects([v]), [v]);
});

test('steady quality is not flagged — no crying wolf on ordinary jitter', () => {
  // A 0.04 wobble, well under the 0.15 threshold.
  const scores = [...run(0, 6, 0.84), ...run(6, 6, 0.8)];
  const [v] = detectQualityRegression(scores, { recentSize: 6, minSamples: 5 });

  assert.equal(v.status, 'ok');
  assert.deepEqual(v.dimensions, []);
  assert.match(v.detail, /Holding steady/);
  assert.deepEqual(regressedSubjects([v]), []);
});

test('a drop exactly at the threshold counts; just under it does not', () => {
  const at = detectQualityRegression([...run(0, 5, 0.9), ...run(5, 5, 0.75)], {
    recentSize: 5,
    minSamples: 5,
    dropThreshold: 0.15,
  });
  assert.equal(at[0].status, 'regressed');

  const under = detectQualityRegression([...run(0, 5, 0.9), ...run(5, 5, 0.76)], {
    recentSize: 5,
    minSamples: 5,
    dropThreshold: 0.15,
  });
  assert.equal(under[0].status, 'ok');
});

test('faithfulness can regress on its own while quality holds', () => {
  const scores = [...run(0, 5, 0.9, 0.9), ...run(5, 5, 0.88, 0.4)];
  const [v] = detectQualityRegression(scores, { recentSize: 5, minSamples: 5 });

  assert.equal(v.status, 'regressed');
  assert.deepEqual(v.dimensions, ['faithfulness']);
  assert.match(v.detail, /faithfulness fell from 0\.9 to 0\.4/);
  assert.doesNotMatch(v.detail, /quality fell/);
});

test('a judge outage never reads as a quality collapse — unjudged verdicts are excluded', () => {
  // Every recent run is unjudged (retained as 0/0 by design). Only the 10 good judged ones remain,
  // which is not enough of a split to say anything — and certainly not "quality dropped to zero".
  const scores = [...run(0, 10, 0.9), ...run(10, 10, 0, 0, { judged: false })];
  const [v] = detectQualityRegression(scores, { recentSize: 10, minSamples: 5 });

  assert.equal(v.status, 'insufficient-data');
  assert.equal(v.recentCount, 10);
  assert.equal(v.baselineCount, 0);
  assert.equal(v.recentQuality, 0.9); // the judged runs, not the outage zeros
});

test('too few runs yields insufficient-data, never an inferred regression', () => {
  // Two terrible recent runs after two good ones would LOOK like a collapse. It is not evidence.
  const scores = [...run(0, 2, 0.95), ...run(2, 2, 0.1)];
  const [v] = detectQualityRegression(scores, { recentSize: 2, minSamples: 5 });

  assert.equal(v.status, 'insufficient-data');
  assert.deepEqual(v.dimensions, []);
  assert.match(v.detail, /need 5 of each/);
  assert.deepEqual(regressedSubjects([v]), []);
});

test('subjects are judged independently and returned in stable order', () => {
  const scores = [
    ...run(0, 5, 0.9).map((s) => ({ ...s, subjectId: 'agent_b' })),
    ...run(5, 5, 0.4).map((s) => ({ ...s, subjectId: 'agent_b' })),
    ...run(0, 5, 0.9).map((s) => ({ ...s, subjectId: 'agent_a', runId: `a_${s.runId}` })),
    ...run(5, 5, 0.88).map((s) => ({ ...s, subjectId: 'agent_a', runId: `a2_${s.runId}` })),
  ];
  const out = detectQualityRegression(scores, { recentSize: 5, minSamples: 5 });

  assert.deepEqual(
    out.map((v) => [v.subjectId, v.status]),
    [
      ['agent_a', 'ok'],
      ['agent_b', 'regressed'],
    ],
  );
  assert.deepEqual(regressedSubjects(out).map((v) => v.subjectId), ['agent_b']);
});

test('query order cannot change the verdict — the rule sorts by time itself', () => {
  const chronological = [...run(0, 5, 0.9), ...run(5, 5, 0.4)];
  const newestFirst = [...chronological].reverse();
  const shuffled = [chronological[7], chronological[0], chronological[9], ...chronological.slice(1, 7), chronological[8]];

  const a = detectQualityRegression(chronological, { recentSize: 5, minSamples: 5 })[0];
  const b = detectQualityRegression(newestFirst, { recentSize: 5, minSamples: 5 })[0];
  const c = detectQualityRegression(shuffled, { recentSize: 5, minSamples: 5 })[0];

  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(a.status, 'regressed');
});

test('an improvement is never reported as a regression', () => {
  const scores = [...run(0, 5, 0.4), ...run(5, 5, 0.95)];
  const [v] = detectQualityRegression(scores, { recentSize: 5, minSamples: 5 });
  assert.equal(v.status, 'ok');
  assert.equal(v.recentQuality, 0.95);
  assert.equal(v.baselineQuality, 0.4);
});

test('no retained verdicts yields no subjects — an empty result, not a false all-clear', () => {
  assert.deepEqual(detectQualityRegression([]), []);
  assert.deepEqual(detectQualityRegression(run(0, 4, 0, 0, { judged: false })), []);
});

test('nonsense options are clamped rather than producing a nonsense verdict', () => {
  const scores = [...run(0, 5, 0.9), ...run(5, 5, 0.3)];
  // recentSize 0 and minSamples 0 both floor to 1: one recent run vs nine baseline.
  const [v] = detectQualityRegression(scores, { recentSize: 0, minSamples: 0 });
  assert.equal(v.recentCount, 1);
  assert.equal(v.baselineCount, 9);
  assert.equal(v.status, 'regressed');
});

test('the defaults are a 10-run recent window with a 5-run minimum on each side', () => {
  // 14 total: newest 10 are recent, leaving 4 baseline — one short of the default minimum.
  const [v] = detectQualityRegression([...run(0, 4, 0.9), ...run(4, 10, 0.2)]);
  assert.equal(v.status, 'insufficient-data');
  assert.equal(v.recentCount, 10);
  assert.equal(v.baselineCount, 4);
  assert.match(v.detail, /need 5 of each/);

  // With a real baseline behind it, the same collapse IS reported.
  const [w] = detectQualityRegression([...run(0, 20, 0.9), ...run(20, 10, 0.2)]);
  assert.equal(w.status, 'regressed');
  assert.equal(w.recentCount, 10);
  assert.equal(w.baselineCount, 20);
});
