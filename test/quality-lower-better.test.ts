import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLabel } from '../src/lib/quality-plain.ts';
import {
  buildQualityPerformance,
  countsTowardQuality,
  isLowerBetter,
  type QualityRunInput,
} from '../src/lib/quality-operator-view.ts';

const run = (over: Partial<QualityRunInput> = {}): QualityRunInput => ({
  id: 'r1',
  score: 90,
  startedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

test('A PERFECT PII RESULT IS NOT 0% QUALITY', () => {
  // pii_leakage scores 0 when NO PII leaked — the best possible outcome. Six such runs on the live
  // deployment were being averaged in as 0% and dragging the org's headline quality figure down, which
  // is reporting the best result as the worst.
  assert.equal(isLowerBetter('pii_leakage:heuristic'), true);
  assert.equal(countsTowardQuality(run({ engine: 'pii_leakage:heuristic', score: 0 })), false);
  // Matched on the token, so a new lower-better evaluator needs no edit here.
  for (const e of ['toxicity:llm', 'hallucination_rate', 'refusal_rate', 'bias:eval', 'unsafe_output']) {
    assert.equal(isLowerBetter(e), true, `${e} must be recognised as lower-better`);
  }
  // And higher-better metrics are untouched.
  for (const e of ['golden', 'ragas', 'faithfulness:grounding', 'answer_relevancy', null, undefined]) {
    assert.equal(isLowerBetter(e), false, `${e} must stay higher-better`);
  }
});

test('A RUN THAT MEASURED NOTHING IS EXCLUDED, not averaged as zero', () => {
  // A degraded run persists score = 0, which is indistinguishable from "everything failed". Averaging
  // it states a catastrophe that did not happen.
  assert.equal(countsTowardQuality(run({ score: 0, degraded: true })), false);
  // A genuine 0 from a higher-better metric that DID measure still counts — that is a real bad result.
  assert.equal(countsTowardQuality(run({ score: 0, engine: 'golden' })), true);
});

test('an unusable score is excluded rather than clamped', () => {
  for (const bad of [-5, 250, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(countsTowardQuality(run({ score: bad })), false, `${bad} must be excluded`);
  }
});

test('THE HEADLINE VERDICT FLIPS ONCE THE ARTEFACTS ARE REMOVED', () => {
  // The live shape: a healthy current window, and a baseline padded with unmeasured zeros and perfect
  // PII results. Averaging those made the CURRENT window look like a collapse.
  const iso = (d: number) => new Date(Date.UTC(2026, 7, d)).toISOString();
  const withArtefacts: QualityRunInput[] = [
    run({ id: 'c1', score: 88, engine: 'golden', startedAt: iso(10) }),
    run({ id: 'c2', score: 91, engine: 'golden', startedAt: iso(9) }),
    run({ id: 'p1', score: 0, engine: 'pii_leakage:heuristic', startedAt: iso(8) }),
    run({ id: 'd1', score: 0, engine: 'faithfulness:heuristic', degraded: true, startedAt: iso(7) }),
    run({ id: 'b1', score: 90, engine: 'golden', startedAt: iso(6) }),
    run({ id: 'b2', score: 89, engine: 'golden', startedAt: iso(5) }),
  ];
  const view = buildQualityPerformance(withArtefacts);
  // Only the four real golden runs survive, so the two windows are comparable.
  assert.equal(view.currentCount + view.baselineCount, 4);
  assert.equal(view.status, 'stable');
  // And no window mean is dragged toward zero.
  assert.ok((view.currentMean ?? 0) > 80, `current mean should be ~90, got ${view.currentMean}`);
  assert.ok((view.baselineMean ?? 0) > 80, `baseline mean should be ~90, got ${view.baselineMean}`);
  assert.ok(Math.abs(view.delta ?? 99) < 7, `delta should be small, got ${view.delta}`);
  // The trend line must not carry the excluded runs either.
  assert.equal(view.trend.length, 4);
  assert.equal(view.trend.some((t) => t.runId === 'p1' || t.runId === 'd1'), false);
});

test('too few USABLE runs reports insufficient rather than inventing a verdict', () => {
  // Previously the excluded runs padded the count over the threshold, so a verdict was computed from
  // artefacts. Now the count reflects real evidence.
  const view = buildQualityPerformance([
    run({ id: 'a', score: 90, engine: 'golden' }),
    run({ id: 'b', score: 0, engine: 'pii_leakage', startedAt: '2026-08-02T00:00:00.000Z' }),
    run({ id: 'c', score: 0, degraded: true, startedAt: '2026-08-03T00:00:00.000Z' }),
    run({ id: 'd', score: 0, degraded: true, startedAt: '2026-08-04T00:00:00.000Z' }),
  ]);
  assert.equal(view.status, 'insufficient');
  assert.equal(view.currentCount, 1);
  assert.equal(view.delta, null);
});

test('THE HEADLINE NAMES THE CHECK IT MEASURES, and lists what it set aside', () => {
  // A single quality % across mixed evaluators is not a weaker measurement — it is not a measurement.
  // On the live box, scores are stored on incompatible scales (golden 0-97, ragas 37-100,
  // faithfulness:grounding 0-23), so an unlabelled mean moved when the evaluator MIX changed rather
  // than when quality did. Removing only the direction/degraded artefacts made it WORSE, measured.
  const iso = (d: number) => new Date(Date.UTC(2026, 7, d)).toISOString();
  const mixed: QualityRunInput[] = [
    ...Array.from({ length: 6 }, (_, i) => run({ id: `g${i}`, score: 88, engine: 'golden', startedAt: iso(20 - i) })),
    ...Array.from({ length: 3 }, (_, i) => run({ id: `r${i}`, score: 12, engine: 'faithfulness:grounding', startedAt: iso(10 - i) })),
  ];
  const view = buildQualityPerformance(mixed);
  assert.equal(view.measuredBy, 'golden');
  assert.deepEqual(view.setAsideEngines, ['faithfulness:grounding']);
  // The low-scale runs must not touch the headline mean.
  assert.equal(view.currentMean, 88);
  assert.equal(view.status, 'stable');
  assert.equal(view.currentCount + view.baselineCount, 6);
});

test('an unattributed run is grouped, not silently mixed into a named check', () => {
  const view = buildQualityPerformance(
    Array.from({ length: 5 }, (_, i) => run({ id: `u${i}`, score: 70, engine: null, startedAt: new Date(Date.UTC(2026, 7, 5 + i)).toISOString() })),
  );
  assert.equal(view.measuredBy, 'unattributed');
});

test('a check LABEL never shows the library that computed it', () => {
  // Engine ids arrive as `faithfulness:ragas`, `pii_leakage:heuristic`. The library is not something a
  // business reader should see, and this vocabulary had leaked onto every quality surface.
  assert.equal(checkLabel('faithfulness:ragas'), 'Faithful to sources');
  assert.equal(checkLabel('pii_leakage:heuristic'), 'No personal data leaked');
  assert.equal(checkLabel('golden'), 'Known-good answers');
  for (const id of ['faithfulness:ragas', 'answer_relevancy:ragas', 'geval', 'pii_leakage:heuristic']) {
    assert.doesNotMatch(checkLabel(id), /ragas|evidently|heuristic|geval|llm.guard/i, `${id} leaked its engine`);
  }
  // An unknown id still gets a label, because this is used where one is structurally required —
  // showing the raw id there is the failure being fixed.
  assert.equal(checkLabel('some_new_check:v2'), 'Some new check');
  assert.equal(checkLabel(''), 'Unattributed check');
});
