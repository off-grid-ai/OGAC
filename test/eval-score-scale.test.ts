import assert from 'node:assert/strict';
import { test } from 'node:test';
import { meanScore, mixesScales, normalizeScore, scorePercent } from '../src/lib/eval-score-scale.ts';

// The exact values measured on the demo tenant, which is what exposed the two scales.
const LIVE = [
  { engine: 'golden', score: 87.79 },
  { engine: 'answer_relevancy:ragas', score: 80 },
  { engine: 'faithfulness:grounding', score: 0.0867 },
  { engine: 'faithfulness:heuristic', score: 0 },
];

test('both storage scales normalise to the same 0-1 space', () => {
  assert.equal(scorePercent({ score: 87.79 }), 88); // stored 0-100
  assert.equal(scorePercent({ score: 0.0867 }), 9); // stored 0-1
  assert.equal(scorePercent({ score: 80 }), 80);
  assert.equal(scorePercent({ score: 0.8 }), 80); // the SAME quality, either scale
});

test('the live mixed set is detected — this is what made the old mean meaningless', () => {
  assert.equal(mixesScales(LIVE), true);
  assert.equal(mixesScales([{ score: 0.9 }, { score: 0.8 }]), false);
  assert.equal(mixesScales([{ score: 90 }, { score: 80 }]), false);
});

test('mean is computed after normalising, not across raw units', () => {
  // Raw mean of [87.79, 80, 0.0867, 0] is ~42 — nonsense. Normalised it is ~0.42 of a real 0-1 scale.
  const m = meanScore(LIVE);
  assert.ok(m !== null && m > 0.4 && m < 0.45, `got ${m}`);
});

test('exactly 1 needs no decision — perfect on either scale', () => {
  assert.equal(normalizeScore(1), 1);
});

test('an empty or unusable set is null, never 0', () => {
  // 0 would read as "everything failed" instead of "nothing was measured".
  assert.equal(meanScore([]), null);
  assert.equal(meanScore([null, undefined, { score: Number.NaN }]), null);
  assert.equal(scorePercent(null), null);
});

test('out-of-range scores are rejected, not clamped', () => {
  // 250 means the writer is wrong; clamping to 100% would hide that in the average.
  assert.equal(normalizeScore(250), null);
  assert.equal(normalizeScore(-5), null);
  assert.equal(normalizeScore(Infinity), null);
});

test('a real zero survives as zero', () => {
  assert.equal(scorePercent({ score: 0 }), 0);
  assert.equal(meanScore([{ score: 0 }, { score: 1 }]), 0.5);
});
