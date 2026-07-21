import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capEvalSamples, evalSampleLimit } from '../src/lib/eval-sampling.ts';

test('evalSampleLimit defaults to 6 on blank/invalid', () => {
  assert.equal(evalSampleLimit({}), 6);
  assert.equal(evalSampleLimit({ OFFGRID_EVAL_SAMPLE_LIMIT: '' }), 6);
  assert.equal(evalSampleLimit({ OFFGRID_EVAL_SAMPLE_LIMIT: 'x' }), 6);
  assert.equal(evalSampleLimit({ OFFGRID_EVAL_SAMPLE_LIMIT: '0' }), 6);
  assert.equal(evalSampleLimit({ OFFGRID_EVAL_SAMPLE_LIMIT: '-3' }), 6);
});

test('evalSampleLimit reads a positive integer and floors + ceilings', () => {
  assert.equal(evalSampleLimit({ OFFGRID_EVAL_SAMPLE_LIMIT: '3' }), 3);
  assert.equal(evalSampleLimit({ OFFGRID_EVAL_SAMPLE_LIMIT: '12.9' }), 12);
  assert.equal(evalSampleLimit({ OFFGRID_EVAL_SAMPLE_LIMIT: '9999' }), 200);
});

test('capEvalSamples takes the first N, never returns empty for a non-empty input', () => {
  const cases = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual(capEvalSamples(cases, 5), [0, 1, 2, 3, 4]);
  assert.equal(capEvalSamples(cases, 100).length, 20);
  assert.deepEqual(capEvalSamples(cases, 0), [0]); // clamped to at least 1
  assert.deepEqual(capEvalSamples([], 5), []);
});
