import assert from 'node:assert/strict';
import test from 'node:test';
import { splitList, validateBlueprint, validateDeployment, type SolutionBlueprintInput } from '../src/lib/solution-blueprints.ts';

const validBlueprint = (): SolutionBlueprintInput => ({
  title: 'Delinquency Intervention',
  summary: 'Prioritise high-risk accounts before they roll forward.',
  industry: 'Lending',
  process: 'Collections',
  businessOwner: 'Head of Collections',
  requiredDataDomains: ['loan accounts'],
  requiredTools: ['case management'],
  governedPipeline: 'Loan Underwriting',
  sourceTemplateKey: 'loan-underwriting',
  outcome: {
    metricName: '30+ DPD rate', metricUnit: '%', direction: 'decrease', measurementWindow: '90 days',
    baseline: { value: 12, label: 'Portfolio baseline' }, target: { value: 9, label: 'Target rate' }, measured: null,
    roi: { currency: 'USD', annualBenefit: 800000, implementationCost: 120000, annualOperatingCost: 80000, rationale: 'Avoided credit loss' },
  },
  proof: { version: '2.1', provenDeployments: 4, summary: 'Validated across four retail books.', evidenceLinks: ['/governance/evidence'] },
});

test('validateBlueprint accepts a complete proven-use-case contract', () => {
  assert.deepEqual(validateBlueprint(validBlueprint()), []);
});

test('validateBlueprint rejects incomplete requirements, proof and unsafe links', () => {
  const input = validBlueprint();
  Object.assign(input, { title: '', summary: '', industry: '', process: '', businessOwner: '', governedPipeline: '', sourceTemplateKey: '' });
  input.requiredDataDomains = [];
  input.requiredTools = [''];
  input.proof = { version: '', provenDeployments: -1, summary: '', evidenceLinks: ['javascript:alert(1)'] };
  assert.equal(validateBlueprint(input).length, 13);
});

test('deployment validation keeps bindings canonical and links safe', () => {
  assert.deepEqual(validateDeployment({ blueprintId: 'bp', appId: 'app', status: 'active', evidenceLinks: ['/evidence'] }), []);
  assert.deepEqual(validateDeployment({ blueprintId: '', appId: '', status: 'bad' as 'active', evidenceLinks: ['file:///secret'] }), [
    'blueprint is required', 'app is required', 'invalid deployment status', 'evidence links must be relative or HTTP URLs',
  ]);
});

test('splitList normalizes comma/newline input and removes duplicates', () => {
  assert.deepEqual(splitList('claims, policies\nclaims,  premiums '), ['claims', 'policies', 'premiums']);
});
