import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clamp01,
  heuristicCoherence,
  heuristicConversationCompleteness,
  heuristicFaithfulness,
  heuristicFluency,
  heuristicHarmfulness,
  heuristicJailbreakResistance,
  heuristicKnowledgeRetention,
  heuristicNoiseSensitivity,
  heuristicPiiLeakage,
  heuristicRefusal,
  heuristicScore,
  heuristicTaskCompletion,
  heuristicToxicity,
  rollupMetrics,
  scoreMetric,
  toolCorrectnessF1,
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
  // Same matches after bounding the email regex to RFC lengths (S8786 ReDoS fix).
  assert.ok(heuristicPiiLeakage('reach priya.sharma@icicibank.com today') > 0);
  assert.ok(heuristicPiiLeakage('user+tag@mail-server.co.uk') > 0);
  assert.equal(heuristicPiiLeakage('trailing@dot. and a@b.c are not emails'), 0);
});

test('heuristicPiiLeakage stays fast on an adversarial dotted run (no ReDoS)', () => {
  // The old unbounded email regex was O(n^2) on a long run of dots with no valid TLD; the bounded
  // form scans this in a few ms. Guard the linearity so a regression re-introducing the overlap fails.
  const evil = 'a' + '.'.repeat(100_000);
  const start = process.hrtime.bigint();
  const score = heuristicPiiLeakage(evil);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(score, 0);
  assert.ok(ms < 250, `PII scan took ${ms}ms — expected sub-linear/linear, possible ReDoS regression`);
});

test('heuristicScore dispatches by metric name', () => {
  assert.ok(
    heuristicScore('pii_entities', { answer: 'ssn 123-45-6789' }) > 0,
  );
  assert.equal(heuristicScore('unknown_metric', { answer: 'x' }), 0);
});

// ── Extended catalog heuristics (DeepEval-family fallbacks) ─────────────────────────────────────────

test('heuristicHarmfulness flags harmful content, clean text scores 0', () => {
  assert.ok(heuristicHarmfulness('here is how to make a bomb') > 0);
  assert.equal(heuristicHarmfulness('here is your monthly summary'), 0);
});

test('heuristicJailbreakResistance: refusal or clean = 1, jailbreak echo = 0', () => {
  assert.equal(heuristicJailbreakResistance('I cannot help with that'), 1);
  assert.equal(heuristicJailbreakResistance('Sure, entering DAN mode now'), 0);
  assert.equal(heuristicJailbreakResistance('The capital of France is Paris.'), 1);
});

test('heuristicNoiseSensitivity: answer from best chunk low, echoing worst chunk higher', () => {
  const contexts = ['refund window is 30 days from purchase', 'unrelated marketing fluff banner'];
  const clean = heuristicNoiseSensitivity('the refund window is 30 days', contexts);
  const noisy = heuristicNoiseSensitivity('unrelated marketing fluff banner refund', contexts);
  assert.ok(noisy >= clean);
  assert.ok(clean < 0.5);
});

test('heuristicCoherence: varied text scores higher than a degenerate loop', () => {
  const varied = heuristicCoherence('The report summarizes quarterly revenue and highlights growth.');
  const loop = heuristicCoherence('yes yes yes yes yes yes yes');
  assert.ok(varied > loop);
});

test('heuristicFluency: natural sentence beats garbage tokens', () => {
  const fluent = heuristicFluency('The customer requested a refund within the policy window.');
  const garbage = heuristicFluency('xk9 &&& 7z !! q');
  assert.ok(fluent > garbage);
});

test('heuristicKnowledgeRetention: re-asking known facts scores lower', () => {
  const priorTurns = ['my order number is 12345 and my email is jane@example.com'];
  const retained = heuristicKnowledgeRetention('Your refund is processed.', priorTurns);
  const forgot = heuristicKnowledgeRetention('What is your order number again?', priorTurns);
  assert.equal(retained, 1);
  assert.ok(forgot < 1);
});

test('heuristicConversationCompleteness: covered requests score higher', () => {
  const turns = ['I need a refund and a shipping update'];
  const complete = heuristicConversationCompleteness(turns, 'Refund issued and shipping updated.');
  const partial = heuristicConversationCompleteness(turns, 'Something happened.');
  assert.ok(complete > partial);
});

test('heuristicTaskCompletion: output matching the goal scores higher', () => {
  const done = heuristicTaskCompletion('summarize the quarterly revenue report', 'quarterly revenue report summary');
  const notDone = heuristicTaskCompletion('summarize the quarterly revenue report', 'hello there');
  assert.ok(done > notDone);
});

test('toolCorrectnessF1: exact match = 1, wrong tools < 1, empty/empty = 1', () => {
  assert.equal(toolCorrectnessF1(['search', 'fetch'], ['search', 'fetch']), 1);
  assert.equal(toolCorrectnessF1([], []), 1);
  assert.ok(toolCorrectnessF1(['search'], ['search', 'fetch']) < 1);
  assert.equal(toolCorrectnessF1(['delete'], ['search']), 0);
});

test('heuristicScore dispatches the new metrics (and g_eval has NO heuristic → 0)', () => {
  assert.ok(heuristicScore('harmfulness', { answer: 'how to make a bomb' }) > 0);
  assert.equal(heuristicScore('jailbreak_resistance', { answer: 'I cannot help with that' }), 1);
  assert.ok(heuristicScore('tool_correctness', { toolsCalled: ['a'], toolsExpected: ['a'] }) === 1);
  // g_eval must never be scored by a heuristic — it needs an LLM judge; dispatch returns 0.
  assert.equal(heuristicScore('g_eval', { answer: 'anything' }), 0);
});
