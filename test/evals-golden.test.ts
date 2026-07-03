import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isRunnableEngine,
  resolveRunEngine,
  validateGoldenCase,
} from '../src/lib/evals-golden.ts';

// Unit tests for the PURE golden-case validation/normalization + run-engine gate — no mocks, no
// I/O. These are the rules the write routes (POST/PATCH /golden-cases) and the run route
// (POST /evals/run) enforce before touching the DB.

test('validateGoldenCase: accepts a full case and trims fields', () => {
  const r = validateGoldenCase({
    name: '  Refund policy  ',
    query: '  what is the refund window?  ',
    expected: '  30 days  ',
    suite: '  promptfoo  ',
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.value, {
    name: 'Refund policy',
    query: 'what is the refund window?',
    expected: '30 days',
    suite: 'promptfoo',
  });
});

test('validateGoldenCase: name defaults to query, suite defaults to golden', () => {
  const r = validateGoldenCase({ query: 'q', expected: 'e' });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.name, 'q');
  assert.equal(r.ok && r.value.suite, 'golden');
});

test('validateGoldenCase: rejects missing/blank query', () => {
  for (const input of [{}, { expected: 'e' }, { query: '   ', expected: 'e' }, null, undefined]) {
    const r = validateGoldenCase(input as never);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /query is required/);
  }
});

test('validateGoldenCase: rejects missing/blank expected', () => {
  const r = validateGoldenCase({ query: 'q', expected: '  ' });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /expected is required/);
});

test('validateGoldenCase: non-string fields are treated as absent', () => {
  const r = validateGoldenCase({ name: 42, query: 'q', expected: 'e', suite: {} } as never);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.name, 'q'); // numeric name → fall back to query
  assert.equal(r.ok && r.value.suite, 'golden'); // object suite → default
});

test('isRunnableEngine: only known engines, case/space tolerant', () => {
  assert.equal(isRunnableEngine('golden'), true);
  assert.equal(isRunnableEngine('  PromptFoo '), true);
  assert.equal(isRunnableEngine('ragas'), true);
  assert.equal(isRunnableEngine('deepeval'), false);
  assert.equal(isRunnableEngine(undefined), false);
  assert.equal(isRunnableEngine(7), false);
});

test('resolveRunEngine: empty → golden default, unknown → null', () => {
  assert.equal(resolveRunEngine(undefined), 'golden');
  assert.equal(resolveRunEngine(''), 'golden');
  assert.equal(resolveRunEngine('  '), 'golden');
  assert.equal(resolveRunEngine('RAGAS'), 'ragas');
  assert.equal(resolveRunEngine('nope'), null);
});
