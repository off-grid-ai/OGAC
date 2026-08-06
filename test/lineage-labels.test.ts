import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  leaksInternalName,
  lineageLabel,
  publicLabel,
  publicSourceLabel,
} from '../src/lib/lineage-labels.ts';

test('the two names seen live on the lineage graph are removed', () => {
  assert.equal(lineageLabel('Knowledge base (Brain)'), 'Knowledge base (knowledge)');
  assert.equal(lineageLabel('brain.retrieve.qdrant'), 'knowledge.retrieve.vector index');
  assert.equal(leaksInternalName(lineageLabel('brain.retrieve.qdrant')), false);
});

test('every engine name we assemble from is caught', () => {
  for (const raw of ['ragas.faithfulness', 'evidently.drift', 'llm-guard.output', 'langfuse.trace',
                     'opensearch.query', 'seaweedfs.put', 'clickhouse.insert', 'kestra.flow',
                     'keycloak.token', 'openbao.read']) {
    assert.equal(leaksInternalName(lineageLabel(raw)), false, `${raw} still leaks`);
  }
});

test('ordinary names pass through untouched', () => {
  assert.equal(lineageLabel('con_f5c959:expense_claims'), 'con_f5c959:expense_claims');
  assert.equal(lineageLabel('Employee Reimbursement Policy'), 'Employee Reimbursement Policy');
});

test('word boundaries are respected — a real word containing a match is not mangled', () => {
  assert.equal(lineageLabel('brainstorm_notes'), 'brainstorm_notes');
});

test('empty and null inputs yield an empty string rather than throwing', () => {
  for (const v of [null, undefined, '', '   ']) assert.equal(lineageLabel(v), '');
});

// ── The Quality page's Engine column ────────────────────────────────────────────────────────────────
//
// LIVE FINDING. /solutions/quality/performance rendered "answer_relevancy:ragas" in an Engine badge —
// naming the OSS evaluator that scored a customer's answer, on a customer-facing surface.
test('publicLabel strips the evaluator names shown in the Quality engine column', () => {
  assert.equal(leaksInternalName(publicLabel('answer_relevancy:ragas')), false);
  assert.match(publicLabel('answer_relevancy:ragas'), /quality checks/);
  // These two are already plain and must survive untouched — they describe the METHOD, not a vendor.
  assert.equal(publicLabel('faithfulness:grounding'), 'faithfulness:grounding');
  assert.equal(publicLabel('pii_leakage:heuristic'), 'pii_leakage:heuristic');
});

// ── Source labels: "Purpose (Engine)" needs the two halves treated differently ────────────────────
//
// Found by sweeping the demo routes as a viewer, not by reading components: the Catalog cards printed
// "Object store (SeaweedFS)" and "Warehouse (ClickHouse)". Substituting inside the parenthesis would
// have produced "Object store (object store)", so the parenthetical is dropped when it names
// something internal — and KEPT when it names something the customer owns.

test('an internal engine in parentheses is dropped, leaving the purpose', () => {
  assert.equal(publicSourceLabel('Object store (SeaweedFS)'), 'Object store');
  assert.equal(publicSourceLabel('Warehouse (ClickHouse)'), 'Warehouse');
  assert.equal(publicSourceLabel('Vector index (Qdrant)'), 'Vector index');
});

test("the CUSTOMER's own engine is kept — it is useful, not a leak", () => {
  // Their database, in a catalogue of their data. Redacting this would make the product look like it
  // connects to nothing, which is the opposite of the point.
  assert.equal(publicSourceLabel('Core Insurance (Postgres)'), 'Core Insurance (Postgres)');
  assert.equal(publicSourceLabel('Policy Admin (MySQL)'), 'Policy Admin (MySQL)');
});

test('a bare internal name with no parenthetical is still replaced', () => {
  assert.equal(publicSourceLabel('SeaweedFS'), 'object store');
  assert.equal(publicSourceLabel('Marquez'), 'lineage store');
});

test('ordinary labels and empty input are unharmed', () => {
  assert.equal(publicSourceLabel('Claims register'), 'Claims register');
  assert.equal(publicSourceLabel(''), '');
  assert.equal(publicSourceLabel(null), '');
});
