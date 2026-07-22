import assert from 'node:assert/strict';
import test from 'node:test';
import { SEEDED_SOLUTION_BLUEPRINTS } from '@/lib/solution-blueprint-seeds';
import { BANK_APPS } from '@/lib/tour-demo-seed';

test('Bank RM cross-sell adoption and execution require both governed evidence sources', () => {
  const blueprint = SEEDED_SOLUTION_BLUEPRINTS.find((item) => item.key === 'bank-rm-cross-sell');
  assert.ok(blueprint);
  assert.deepEqual(blueprint.input.requiredDataDomains, ['customer data', 'pricing rate card']);

  const app = BANK_APPS.find((item) => item.key === 'cross-sell');
  assert.ok(app);
  assert.deepEqual(
    app.steps.filter((step) => step.kind === 'connector-query').map((step) => step.domain),
    ['customer data', 'pricing rate card'],
  );
});
