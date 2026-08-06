// The fixture below is the real fact list the copilot assembled on 2026-08-06, from which a 2B model
// produced "Pipeline data is successfully masked by the service account" — records stitched together
// because they were in the prompt, not because they related to the question.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Citation } from '@/lib/copilot-context';
import { scoreFact, selectRelevantFacts } from '@/lib/copilot-relevance';

let n = 0;
const fact = (source: Citation['source'], text: string): Citation => ({ n: (n += 1), source, text });

const GATHERED: Citation[] = [
  fact('anomaly', 'daily cost spike on 2026-07-02: value 0.0086 vs baseline 0.0031 (critical)'),
  fact('anomaly', 'daily cost spike on 2026-07-29: value 0.0435 vs baseline 0.0033 (critical)'),
  fact('drift', 'Drift verdict: drift (score 1), 2/2 features drifted'),
  fact('drift', 'Feature "score (K-S p_value)" drifted (score 0.0004, drift)'),
  fact('evals', 'Evals: 61% pass across 279 cases in 25 runs (108 failed)'),
  fact('evals', 'Suite "faithfulness" 7% pass (51/55 cases failed)'),
  fact('finops', 'Spend: $0.35 over 181 requests / 173720 tokens (69% served locally at $0)'),
  fact('finops', 'Model "Qwen3-VL 8B Instruct": $0.12 over 56 requests'),
  fact('audit', '2026-08-04 — pipeline data refused by proof ceiling in this organisation: blocked'),
  fact('audit', '2026-08-04 — agent run by a service account in this organisation: ok'),
  fact('audit', '2026-08-01 — claim document read by Suraksha Demo in this organisation: ok'),
];

test('a cost question gets the cost records, not the drift ones', () => {
  const picked = selectRelevantFacts('What is this costing us?', GATHERED);
  assert.ok(picked.length > 0, 'a cost question must find something');
  assert.ok(picked.some((c) => c.source === 'finops'), 'the spend rows are the answer');
  assert.ok(!picked.some((c) => c.source === 'drift'), 'feature drift is not a cost answer');
});

test('a source can carry a record whose words never match', () => {
  // A spend row says "$0.35 over 181 requests" and never says "cost". Term overlap alone missed
  // every one of them, which is how a cost question got answered with feature drift.
  const spend = GATHERED.find((c) => c.text.startsWith('Spend:'))!;
  assert.equal(spend.text.toLowerCase().includes('cost'), false, 'fixture check');
  assert.ok(scoreFact('what is this costing us?', spend) > 0);
});

test('an unrelated question selects nothing rather than the best of a bad set', () => {
  // Returning a weak match so the answer has something to cite is exactly how an off-topic record
  // reaches a buyer labelled "Evidence". Empty is a real, honest outcome.
  const picked = selectRelevantFacts('Who founded this company and where are they based?', GATHERED);
  assert.deepEqual(picked, []);
});

test('the numbers are dense and start at 1 after filtering', () => {
  // The model cites by number. Drop record 7 and leave the rest as 8, 9, 20 and every [n] marker in
  // the answer points at nothing.
  const picked = selectRelevantFacts('what was blocked in the audit log?', GATHERED);
  assert.ok(picked.length > 0);
  assert.deepEqual(picked.map((c) => c.n), picked.map((_, i) => i + 1));
});

test('the pile actually shrinks — that is the latency half of the fix', () => {
  const picked = selectRelevantFacts('what stops a bad answer reaching a customer?', GATHERED);
  assert.ok(picked.length < GATHERED.length, 'a 2B given everything is what caused the bad answer');
  assert.ok(picked.length <= 8, 'and the cap holds');
});

test('the cap keeps the strongest, not the first', () => {
  const many = [
    ...Array.from({ length: 20 }, (_, i) => fact('audit', `unrelated housekeeping event ${i}`)),
    fact('audit', 'a request was blocked because it contained a PAN'),
  ];
  const picked = selectRelevantFacts('was anything blocked for containing a PAN?', many, 3);
  assert.equal(picked.length, 3);
  assert.ok(picked[0].text.includes('PAN'), 'the record that answers it must come first');
});

test('an empty or meaningless question selects nothing', () => {
  for (const q of ['', '   ', 'the and of it']) assert.deepEqual(selectRelevantFacts(q, GATHERED), []);
});

test('nothing gathered stays nothing — no invention', () => {
  assert.deepEqual(selectRelevantFacts('what is this costing us?', []), []);
});
