import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGEvalPrompt,
  gEvalUnavailable,
  parseGEvalScore,
  GEVAL_SCALE_MAX,
  GEVAL_SCALE_MIN,
} from '../src/lib/eval-geval.ts';

// Unit tests for the PURE G-Eval (LLM-as-judge) prompt builder + verdict parser. No I/O — the runner
// owns the gateway call; this owns only prompt shaping and honest parsing.

test('buildGEvalPrompt embeds the criteria and the answer, asks for a SCORE line', () => {
  const p = buildGEvalPrompt('Does the answer cite a policy doc and stay under 200 words?', {
    question: 'What is the refund window?',
    answer: 'Per policy §3, the refund window is 30 days.',
    contexts: ['Policy §3: refunds within 30 days.'],
    groundTruth: '30 days.',
  });
  assert.match(p.system, /SCORE:/);
  assert.match(p.system, new RegExp(`${GEVAL_SCALE_MIN}`));
  assert.match(p.system, new RegExp(`${GEVAL_SCALE_MAX}`));
  assert.match(p.user, /cite a policy doc/);
  assert.match(p.user, /refund window is 30 days/);
  assert.match(p.user, /CONTEXT/);
  assert.match(p.user, /REFERENCE ANSWER/);
});

test('buildGEvalPrompt omits empty sections but always includes the answer', () => {
  const p = buildGEvalPrompt('Be concise.', { answer: 'ok' });
  assert.doesNotMatch(p.user, /QUESTION/);
  assert.doesNotMatch(p.user, /CONTEXT/);
  assert.doesNotMatch(p.user, /REFERENCE ANSWER/);
  assert.match(p.user, /ANSWER/);
});

test('buildGEvalPrompt falls back to a default rule when criteria is blank', () => {
  const p = buildGEvalPrompt('   ', { answer: 'x' });
  assert.match(p.user, /Rate the overall quality/);
});

test('parseGEvalScore reads an explicit SCORE line and normalizes 1..5 → 0..1', () => {
  const r = parseGEvalScore('The answer cites the policy and is concise.\nSCORE: 5');
  assert.equal(r.parsed, true);
  assert.equal(r.raw, 5);
  assert.equal(r.score, 1);
  assert.match(r.rationale, /cites the policy/);
});

test('parseGEvalScore maps mid + low scores correctly', () => {
  assert.equal(parseGEvalScore('SCORE: 3').score, 0.5);
  assert.equal(parseGEvalScore('SCORE: 1').score, 0);
  assert.equal(parseGEvalScore('reasoning\nScore = 4').raw, 4);
});

test('parseGEvalScore falls back to the last 1..5 integer when unlabeled', () => {
  const r = parseGEvalScore('I would rate this a 4 out of 5.');
  assert.equal(r.parsed, true);
  assert.equal(r.raw, 5); // "5" is the last standalone 1..5 integer (from "out of 5")
});

test('parseGEvalScore reports UNPARSED (never fabricates) when no verdict is present', () => {
  const r = parseGEvalScore('I am not sure how to score this.');
  assert.equal(r.parsed, false);
  assert.equal(r.raw, null);
  assert.equal(r.score, 0);
});

test('parseGEvalScore on empty text is unparsed, not a fake 0-pass', () => {
  const r = parseGEvalScore('');
  assert.equal(r.parsed, false);
  assert.equal(r.raw, null);
});

test('gEvalUnavailable is an honest no-score with the reason', () => {
  const r = gEvalUnavailable('No gateway judge configured.');
  assert.equal(r.parsed, false);
  assert.equal(r.score, 0);
  assert.match(r.rationale, /No gateway judge/);
});
