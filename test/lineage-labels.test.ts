import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leaksInternalName, lineageLabel } from '../src/lib/lineage-labels.ts';

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
