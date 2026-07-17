import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SEEDED_SOLUTION_BLUEPRINTS,
  SOLUTION_BLUEPRINT_CATALOG_VERSION,
} from '../src/lib/solution-blueprint-seeds.ts';
import { validateBlueprint } from '../src/lib/solution-blueprints.ts';

test('starter catalog is versioned, valid and never fabricates proof or measured results', () => {
  assert.equal(SOLUTION_BLUEPRINT_CATALOG_VERSION, 1);
  assert.deepEqual(
    SEEDED_SOLUTION_BLUEPRINTS.map((seed) => seed.key),
    ['lending-delinquency-intervention', 'insurance-indemnity-fast-track'],
  );
  for (const seed of SEEDED_SOLUTION_BLUEPRINTS) {
    assert.deepEqual(validateBlueprint(seed.input), []);
    assert.equal(seed.input.proof.status, 'unverified');
    assert.equal(seed.input.proof.evidenceLinks.length, 0);
    assert.equal(seed.input.outcome.measured, null);
    assert.equal(seed.input.outcome.roi.annualBenefit, 0);
  }
});

test('high-value use cases require dedicated runtime contracts, not unrelated demo workflows', () => {
  assert.equal(
    SEEDED_SOLUTION_BLUEPRINTS[0].input.requiredPipelineName,
    'Collections intervention',
  );
  assert.equal(SEEDED_SOLUTION_BLUEPRINTS[0].input.sourceTemplateKey, 'delinquency-intervention');
  assert.equal(SEEDED_SOLUTION_BLUEPRINTS[1].input.requiredPipelineName, 'Indemnity claims');
  assert.equal(SEEDED_SOLUTION_BLUEPRINTS[1].input.sourceTemplateKey, 'indemnity-fast-track');
});
