import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestControls, detectConcepts } from '../src/lib/suggest-controls.ts';
import { GUARDRAIL_CATALOG } from '../src/lib/guardrails-catalog.ts';
import { EVAL_TEMPLATES } from '../src/lib/eval-templates.ts';

// PURE unit tests for the auto-suggest mapping (M5). Every suggested id MUST exist in the real
// catalogs (never fabricated); concept detection drives the extras on top of the default floor.

const grIds = new Set(GUARDRAIL_CATALOG.map((g) => g.id));
const evIds = new Set(EVAL_TEMPLATES.map((e) => e.id));

test('detectConcepts fires on purpose + allowlist keywords', () => {
  const c = detectConcepts({
    purpose: 'Summarise customer support tickets and draft replies',
    allowlist: ['payment_records'],
  });
  assert.ok(c.includes('support'));
  assert.ok(c.includes('summarize'));
  assert.ok(c.includes('financial'));
});

test('always suggests the default-enabled guardrail floor', () => {
  const out = suggestControls({ purpose: 'A generic pipeline that does work' });
  const floor = GUARDRAIL_CATALOG.filter((g) => g.defaultEnabled).map((g) => g.id);
  for (const id of floor) {
    assert.ok(out.guardrails.some((g) => g.id === id), `floor guardrail ${id} suggested`);
  }
  // Floor items are labelled recommended.
  assert.ok(out.guardrails.filter((g) => g.confidence === 'recommended').length >= 1);
});

test('financial purpose adds financial-category guardrails', () => {
  const out = suggestControls({ purpose: 'Process bank loan and credit card payment data' });
  const fin = out.guardrails.filter((g) => g.category === 'Financial');
  assert.ok(fin.length >= 1, 'financial guardrails suggested');
});

test('RAG purpose suggests the RAG eval suite', () => {
  const out = suggestControls({
    purpose: 'Answer questions from the internal knowledge base by retrieving documents',
  });
  const ids = out.evals.map((e) => e.id);
  assert.ok(ids.includes('faithfulness'));
  assert.ok(ids.includes('answer_relevancy'));
  assert.ok(ids.includes('context_precision'));
});

test('external/user-facing purpose suggests safety guardrails + evals', () => {
  const out = suggestControls({ purpose: 'A public customer-facing chatbot that replies to users' });
  assert.ok(out.guardrails.some((g) => g.category === 'Content Safety' || g.category === 'Prompt Security'));
  assert.ok(out.evals.some((e) => ['toxicity', 'prompt_injection', 'refusal'].includes(e.id)));
});

test('every suggested id is a REAL catalog id (never fabricated)', () => {
  const out = suggestControls({
    purpose: 'Summarise medical patient records for the finance and support teams',
    allowlist: ['patients', 'invoices'],
  });
  for (const g of out.guardrails) assert.ok(grIds.has(g.id), `guardrail ${g.id} exists`);
  for (const e of out.evals) assert.ok(evIds.has(e.id), `eval ${e.id} exists`);
});

test('suggestions are de-duped and stably ordered by confidence', () => {
  const out = suggestControls({ purpose: 'customer support chatbot' });
  const grUnique = new Set(out.guardrails.map((g) => g.id));
  assert.equal(grUnique.size, out.guardrails.length, 'no duplicate guardrails');
  const order = { recommended: 0, suggested: 1, optional: 2 } as const;
  for (let i = 1; i < out.evals.length; i++) {
    assert.ok(order[out.evals[i - 1].confidence] <= order[out.evals[i].confidence]);
  }
});

test('a bare description still yields a sensible eval floor', () => {
  const out = suggestControls({ purpose: 'do a thing' });
  assert.ok(out.evals.length >= 1, 'never hand back zero evals for a real pipeline');
});
