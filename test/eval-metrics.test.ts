import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clamp01,
  heuristicFaithfulness,
  heuristicPiiLeakage,
  heuristicRefusal,
  heuristicScore,
  heuristicToxicity,
  rollupMetrics,
  scoreMetric,
  verdict,
} from '../src/lib/eval-metrics.ts';

// Unit tests for the PURE metric scoring / thresholding / verdict + heuristic scorers. No I/O.

test('clamp01 bounds values and rejects garbage', () => {
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01('x'), 0);
});

test('verdict respects direction', () => {
  assert.equal(verdict(0.8, 0.7, 'higher-better'), true);
  assert.equal(verdict(0.6, 0.7, 'higher-better'), false);
  assert.equal(verdict(0.1, 0.2, 'lower-better'), true);
  assert.equal(verdict(0.3, 0.2, 'lower-better'), false);
});

test('scoreMetric produces a verdict + honors threshold override + records engine', () => {
  const tpl = { metric: 'faithfulness', direction: 'higher-better' as const, defaultThreshold: 0.8 };
  const s = scoreMetric(tpl, 0.9, 'ragas');
  assert.equal(s.pass, true);
  assert.equal(s.engine, 'ragas');
  const s2 = scoreMetric(tpl, 0.75, 'heuristic', 0.7);
  assert.equal(s2.pass, true); // override lowers the bar
  assert.equal(s2.threshold, 0.7);
});

test('rollupMetrics: mean value → score, verdict count → passed/total', () => {
  const scores = [
    scoreMetric({ metric: 'm', direction: 'higher-better', defaultThreshold: 0.5 }, 1, 'heuristic'),
    scoreMetric({ metric: 'm', direction: 'higher-better', defaultThreshold: 0.5 }, 0, 'heuristic'),
  ];
  const r = rollupMetrics(scores);
  assert.equal(r.total, 2);
  assert.equal(r.passed, 1);
  assert.equal(r.score, 50); // mean of 1.0 and 0.0
});

test('rollupMetrics: empty is zeroed, never NaN', () => {
  assert.deepEqual(rollupMetrics([]), { score: 0, total: 0, passed: 0 });
});

test('heuristicFaithfulness: grounded answer scores high, invented low', () => {
  const grounded = heuristicFaithfulness('the refund window is 30 days', [
    'our refund window is 30 days from purchase',
  ]);
  const invented = heuristicFaithfulness('bananas orbit jupiter quarterly', [
    'the refund window is 30 days',
  ]);
  assert.ok(grounded > invented);
  assert.ok(grounded > 0.5);
});

test('heuristicToxicity flags a toxic token, clean text scores 0', () => {
  assert.ok(heuristicToxicity('you are an idiot') > 0);
  assert.equal(heuristicToxicity('thank you for reaching out'), 0);
});

test('heuristicRefusal detects a refusal', () => {
  assert.equal(heuristicRefusal("I cannot help with that request"), 1);
  assert.equal(heuristicRefusal('Sure, here is how'), 0);
});

test('heuristicPiiLeakage catches an email', () => {
  assert.ok(heuristicPiiLeakage('contact me at jane@example.com') > 0);
  assert.equal(heuristicPiiLeakage('no personal data here'), 0);
});

test('heuristicScore dispatches by metric name', () => {
  assert.ok(
    heuristicScore('pii_entities', { answer: 'ssn 123-45-6789' }) > 0,
  );
  assert.equal(heuristicScore('unknown_metric', { answer: 'x' }), 0);
});
