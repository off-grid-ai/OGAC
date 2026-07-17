import assert from 'node:assert/strict';
import test from 'node:test';
import { SEEDED_SOLUTION_BLUEPRINTS } from '../src/lib/solution-blueprint-seeds.ts';
import { validateBlueprint } from '../src/lib/solution-blueprints.ts';
import { BANK_APPS, INSURER_APPS } from '../src/lib/tour-demo-seed.ts';

test('founder-priority BFSI examples are valid and derive execution requirements from app templates', () => {
  assert.deepEqual(SEEDED_SOLUTION_BLUEPRINTS.map((seed) => seed.key), [
    'lending-delinquency-intervention',
    'insurance-indemnity-fast-track',
  ]);
  for (const seed of SEEDED_SOLUTION_BLUEPRINTS) assert.deepEqual(validateBlueprint(seed.input), []);

  const lending = BANK_APPS.find((app) => app.key === 'loan-underwriting')!;
  const insurance = INSURER_APPS.find((app) => app.key === 'claims-triage')!;
  assert.equal(SEEDED_SOLUTION_BLUEPRINTS[0].input.governedPipeline, lending.pipelineName);
  assert.equal(SEEDED_SOLUTION_BLUEPRINTS[1].input.governedPipeline, insurance.pipelineName);
  assert.deepEqual(
    SEEDED_SOLUTION_BLUEPRINTS[1].input.requiredDataDomains,
    insurance.steps.flatMap((step) => (step.domain ? [step.domain] : [])),
  );
});
