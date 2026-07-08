import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evalEngineLabel } from '../src/lib/eval-engine-label.ts';

// Unit tests for the PURE eval-engine → operator-label mapping. This is the brand-critical rule that
// keeps OSS engine names (ragas / deepeval / presidio / guardrails / promptfoo …) out of the UI: no
// mapped id may ever render back as a raw third-party project name, and unknown ids degrade to a
// safe human-ish label rather than leaking or crashing.

test('evalEngineLabel: maps every known engine to a non-leaky capability label', () => {
  const known = ['ragas', 'deepeval', 'presidio', 'guardrails', 'heuristic', 'evidently', 'golden', 'promptfoo'];
  const leaks = ['ragas', 'deepeval', 'presidio', 'guardrails', 'evidently', 'promptfoo'];
  for (const id of known) {
    const label = evalEngineLabel(id);
    assert.ok(label.length > 0, `${id} → non-empty`);
    // The label must not contain any OSS project name (case-insensitive).
    for (const leak of leaks) {
      assert.ok(
        !label.toLowerCase().includes(leak),
        `label for "${id}" ("${label}") must not leak "${leak}"`,
      );
    }
  }
});

test('evalEngineLabel: is case-insensitive on the id', () => {
  assert.equal(evalEngineLabel('RAGAS'), evalEngineLabel('ragas'));
  assert.equal(evalEngineLabel('DeepEval'), evalEngineLabel('deepeval'));
});

test('evalEngineLabel: unknown id degrades to a title-cased fallback (never blank, never raw project)', () => {
  assert.equal(evalEngineLabel('my_custom'), 'My custom');
  assert.equal(evalEngineLabel('foo-bar'), 'Foo bar');
});

test('evalEngineLabel: null / undefined / empty degrade safely', () => {
  assert.equal(evalEngineLabel(null), 'Check');
  assert.equal(evalEngineLabel(undefined), 'Check');
  assert.equal(evalEngineLabel(''), 'Check');
});
