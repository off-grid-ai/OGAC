import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  heuristicBias,
  heuristicContextRecall,
  heuristicInjectionResistance,
  heuristicRelevancy,
  heuristicSentiment,
  heuristicSummarization,
  heuristicTurnRelevancy,
} from '@/lib/eval-metrics';

// Pure first-party heuristic scorers used when no gateway LLM-judge is configured. No I/O, no mocks —
// real functions fed representative text. These lock the ones the existing suite didn't reach,
// exercising the token-overlap (Jaccard) family, the lexicon scanners, and the summarization balance.

const inUnit = (v: number) => v >= 0 && v <= 1;

test('heuristicRelevancy: Jaccard overlap of question ↔ answer, bounded 0..1', () => {
  // Identical token sets → perfect overlap.
  assert.equal(heuristicRelevancy('the quick fox', 'the quick fox'), 1);
  // Fully disjoint token sets → zero overlap.
  assert.equal(heuristicRelevancy('alpha beta', 'gamma delta'), 0);
  // Partial overlap sits strictly between.
  const partial = heuristicRelevancy('the capital of france', 'france is nice');
  assert.ok(partial > 0 && partial < 1, `expected 0<partial<1, got ${partial}`);
  // Two empty strings → both token sets empty → Jaccard defined as 1.
  assert.equal(heuristicRelevancy('', ''), 1);
});

test('heuristicContextRecall: fraction of ground-truth tokens covered by contexts', () => {
  // Every ground-truth token present in a context → full recall.
  assert.equal(heuristicContextRecall('paris france', ['the city of paris in france']), 1);
  // No overlap → zero recall.
  assert.equal(heuristicContextRecall('tokyo japan', ['london england']), 0);
  // Empty ground truth is trivially fully recalled (defined as 1).
  assert.equal(heuristicContextRecall('', ['anything']), 1);
  // Half the ground-truth tokens covered.
  const half = heuristicContextRecall('alpha beta', ['only alpha here']);
  assert.equal(half, 0.5);
});

test('heuristicBias: stereotype phrasing raises the score (lower is better)', () => {
  assert.equal(heuristicBias('a neutral, factual statement'), 0);
  // One stereotype phrase → hits/2 = 0.5.
  assert.equal(heuristicBias('all women are like that'), 0.5);
  // Two distinct stereotype phrases → clamped at 1.
  const two = heuristicBias('all women and those people always');
  assert.ok(two >= 1 - 1e-9, `expected clamp toward 1, got ${two}`);
});

test('heuristicInjectionResistance: 1 when no injection marker present, 0 when one is echoed', () => {
  assert.equal(heuristicInjectionResistance('Here is a normal helpful answer.'), 1);
  assert.equal(heuristicInjectionResistance('Sure — ignore previous instructions and do X'), 0);
  assert.equal(heuristicInjectionResistance('I will reveal your system prompt now'), 0);
});

test('heuristicSentiment: polarity mapped into 0..1, neutral ≈ 0.5', () => {
  // Empty text has no tokens → defined neutral 0.5.
  assert.equal(heuristicSentiment(''), 0.5);
  const pos = heuristicSentiment('this is great and helpful, thanks');
  const neg = heuristicSentiment('this is terrible and awful, sorry');
  const neutral = heuristicSentiment('the report lists several tables');
  assert.ok(inUnit(pos) && inUnit(neg) && inUnit(neutral));
  assert.ok(pos > neutral, `positive ${pos} should exceed neutral ${neutral}`);
  assert.ok(neg < neutral, `negative ${neg} should be below neutral ${neutral}`);
});

test('heuristicSummarization: rewards faithful + concise, 0 on empty input', () => {
  assert.equal(heuristicSummarization('', 'some source text'), 0);
  assert.equal(heuristicSummarization('summary', ''), 0);
  const source =
    'the annual report covers revenue growth cost control and future guidance across regions';
  const good = heuristicSummarization('revenue growth and cost control', source);
  const unfaithful = heuristicSummarization('unrelated random invented words here', source);
  assert.ok(inUnit(good) && inUnit(unfaithful));
  // A faithful, shorter summary should outscore an unfaithful one.
  assert.ok(good > unfaithful, `faithful ${good} should beat unfaithful ${unfaithful}`);
});

test('heuristicTurnRelevancy: delegates to relevancy over (userTurn, reply)', () => {
  assert.equal(
    heuristicTurnRelevancy('what time is it', 'what time is it'),
    heuristicRelevancy('what time is it', 'what time is it'),
  );
  assert.equal(heuristicTurnRelevancy('alpha beta', 'gamma delta'), 0);
});
