import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EVAL_TEMPLATES,
  engineAvailability,
  getTemplate,
  isDegraded,
  templatesByCategory,
} from '../src/lib/eval-templates.ts';

// Unit tests for the PURE evaluator template catalog + honest engine-availability logic. No I/O.

test('catalog covers the founder-named evaluators', () => {
  const ids = new Set(EVAL_TEMPLATES.map((t) => t.id));
  for (const required of [
    'bias_detection',
    'toxicity',
    'faithfulness',
    'answer_relevancy',
    'context_precision',
    'context_recall',
    'pii_leakage',
    'prompt_injection',
    'refusal',
    'sentiment',
    'summarization',
  ]) {
    assert.ok(ids.has(required), `missing template: ${required}`);
  }
});

test('every template names a valid engine + direction + 0..1 threshold', () => {
  const engines = new Set(['ragas', 'evidently', 'guardrails', 'presidio', 'heuristic']);
  const dirs = new Set(['higher-better', 'lower-better']);
  for (const t of EVAL_TEMPLATES) {
    assert.ok(engines.has(t.engine), `${t.id} bad engine`);
    assert.ok(dirs.has(t.direction), `${t.id} bad direction`);
    assert.ok(t.defaultThreshold >= 0 && t.defaultThreshold <= 1, `${t.id} bad threshold`);
    assert.ok(t.metric.length > 0 && t.method.length > 0);
  }
});

test('getTemplate finds by id, undefined otherwise', () => {
  assert.equal(getTemplate('toxicity')?.metric, 'toxicity');
  assert.equal(getTemplate('nope'), undefined);
});

test('heuristic engine is always available', () => {
  const a = engineAvailability('heuristic', {});
  assert.equal(a.available, true);
  assert.equal(isDegraded('heuristic', {}), false);
});

test('ragas is unavailable without a sidecar url, available with', () => {
  assert.equal(engineAvailability('ragas', {}).available, false);
  assert.match(engineAvailability('ragas', {}).detail, /OFFGRID_RAGAS_URL/);
  assert.equal(engineAvailability('ragas', { ragasUrl: 'http://x' }).available, true);
});

test('evidently is unavailable without a collector url', () => {
  assert.equal(engineAvailability('evidently', {}).available, false);
  assert.equal(engineAvailability('evidently', { evidentlyUrl: 'http://x' }).available, true);
});

test('presidio/guardrails degrade honestly rather than being unavailable', () => {
  // available (falls back) but flagged degraded when no external url configured
  assert.equal(engineAvailability('presidio', {}).available, true);
  assert.equal(isDegraded('presidio', {}), true);
  assert.equal(isDegraded('presidio', { presidioUrl: 'http://x' }), false);
  assert.equal(engineAvailability('guardrails', {}).available, true);
  assert.equal(isDegraded('guardrails', {}), true);
  assert.equal(isDegraded('guardrails', { guardrailsUrl: 'http://x' }), false);
});

test('templatesByCategory groups every template exactly once', () => {
  const grouped = templatesByCategory();
  const count = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
  assert.equal(count, EVAL_TEMPLATES.length);
});
