import assert from 'node:assert/strict';
import { test } from 'node:test';

import { managedEtlBlueprint } from '../src/lib/etl-blueprints.ts';

test('delinquency blueprint exposes the important lender outcome as an ETL job draft', () => {
  const definition = managedEtlBlueprint('bfsi-delinquency-snapshot');
  assert.ok(definition);
  assert.equal(definition.key, 'bfsi-delinquency-snapshot');
  assert.equal(definition.draft.sourceResource, 'bfsi.fact_loan');
  assert.equal(definition.draft.destTable, 'delinquency_orchestration_audit');
  assert.equal(definition.draft.trigger, 'schedule');
  assert.match(definition.outcome, /collections/i);
});

test('unknown blueprint is rejected rather than silently compiling arbitrary SQL', () => {
  assert.equal(managedEtlBlueprint('made-up-workflow'), undefined);
});
