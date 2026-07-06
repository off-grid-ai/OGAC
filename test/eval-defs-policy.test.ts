import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEvalDef } from '../src/lib/eval-defs-policy.ts';

// Unit tests for the PURE eval-definition validation/normalization. No I/O.

test('applying a template needs only a name — fields seed from the template', () => {
  const r = validateEvalDef({ name: 'Hallucination gate', templateId: 'faithfulness' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.metric, 'faithfulness');
    assert.equal(r.value.engine, 'ragas');
    assert.equal(r.value.direction, 'higher-better');
    assert.equal(r.value.threshold, 0.8);
  }
});

test('rejects a missing name', () => {
  const r = validateEvalDef({ templateId: 'toxicity' });
  assert.equal(r.ok, false);
});

test('rejects an unknown template', () => {
  const r = validateEvalDef({ name: 'x', templateId: 'nope' });
  assert.equal(r.ok, false);
});

test('authored-from-scratch requires metric + valid engine + direction', () => {
  const bad = validateEvalDef({ name: 'x', metric: 'custom', engine: 'wat' });
  assert.equal(bad.ok, false);
  const ok = validateEvalDef({
    name: 'Custom',
    metric: 'custom',
    engine: 'heuristic',
    direction: 'higher-better',
  });
  assert.equal(ok.ok, true);
});

test('threshold must be 0..1', () => {
  const bad = validateEvalDef({ name: 'x', templateId: 'toxicity', threshold: 5 });
  assert.equal(bad.ok, false);
  const ok = validateEvalDef({ name: 'x', templateId: 'toxicity', threshold: 0.3 });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.threshold, 0.3);
});

test('trims name and defaults suite to golden', () => {
  const r = validateEvalDef({ name: '  Bias  ', templateId: 'bias_detection' });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.name, 'Bias');
    assert.equal(r.value.suite, 'golden');
  }
});
