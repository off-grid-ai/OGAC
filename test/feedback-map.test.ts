import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chatThumbToGolden,
  hitlCorrectionToGolden,
  FEEDBACK_SUITE,
} from '../src/lib/feedback-map.ts';

// Unit tests for the PURE feedback → golden-case mapper. No I/O.

test('HITL correction with an edited output → golden (query + corrected expected)', () => {
  const r = hitlCorrectionToGolden({
    input: 'What is the claim status?',
    correctedOutput: 'Approved — settlement within 7 days.',
    decision: 'reject',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.query, 'What is the claim status?');
    assert.equal(r.value.expected, 'Approved — settlement within 7 days.');
    assert.equal(r.value.suite, FEEDBACK_SUITE);
  }
});

test('HITL correction falls back to the reviewer note when no explicit output', () => {
  const r = hitlCorrectionToGolden({ input: 'q', note: 'the answer should cite the policy clause' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.expected, 'the answer should cite the policy clause');
});

test('HITL with no ground-truth (approve, no edit/note) is NOT captured — honest', () => {
  const r = hitlCorrectionToGolden({ input: 'q', decision: 'approve' });
  assert.equal(r.ok, false);
});

test('HITL with no input is NOT captured', () => {
  const r = hitlCorrectionToGolden({ correctedOutput: 'x' });
  assert.equal(r.ok, false);
});

test('👍 chat thumb → golden with the answer as expected', () => {
  const r = chatThumbToGolden({ rating: 'up', query: 'PAN format?', answer: 'ABCDE1234F' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.query, 'PAN format?');
    assert.equal(r.value.expected, 'ABCDE1234F');
    assert.equal(r.value.suite, FEEDBACK_SUITE);
  }
});

test('👎 chat thumb WITH a correction → golden with the correction as expected', () => {
  const r = chatThumbToGolden({
    rating: 'down',
    query: 'IFSC length?',
    answer: '10 chars',
    correction: 'IFSC is 11 characters',
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.expected, 'IFSC is 11 characters');
});

test('👎 chat thumb with NO correction is NOT captured (no known-good answer)', () => {
  const r = chatThumbToGolden({ rating: 'down', query: 'q', answer: 'wrong' });
  assert.equal(r.ok, false);
});

test('👍 with no answer is not usable', () => {
  const r = chatThumbToGolden({ rating: 'up', query: 'q' });
  assert.equal(r.ok, false);
});

test('unknown rating is reasoned out', () => {
  const r = chatThumbToGolden({ rating: 'meh', query: 'q', answer: 'a' });
  assert.equal(r.ok, false);
});
