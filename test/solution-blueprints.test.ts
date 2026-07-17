import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateSolutionCompatibility,
  splitList,
  validateBlueprint,
  validateDeployment,
  validateObservation,
  withRealizedRoi,
  type SolutionBlueprintInput,
} from '../src/lib/solution-blueprints.ts';

const validBlueprint = (): SolutionBlueprintInput => ({
  title: 'Delinquency Intervention',
  summary: 'Prioritise high-risk accounts before they roll forward.',
  industry: 'Lending',
  process: 'Collections',
  businessOwner: 'Head of Collections',
  requiredDataDomains: ['loan accounts'],
  requiredCapabilities: ['grounded-inference', 'human-approval', 'report-output'],
  requiredPipelineName: 'Collections intervention',
  sourceTemplateKey: 'collections-intervention',
  outcome: {
    metricName: '30+ DPD rate',
    metricUnit: '%',
    direction: 'decrease',
    measurementWindow: '90 days',
    baseline: { value: 12, label: 'Portfolio baseline' },
    target: { value: 9, label: 'Target rate' },
    measured: null,
    roi: {
      currency: 'USD',
      annualBenefit: 800000,
      implementationCost: 120000,
      annualOperatingCost: 80000,
      rationale: 'Avoided credit loss',
    },
  },
  proof: {
    status: 'verified',
    summary: 'Validated benchmark.',
    evidenceLinks: ['/governance/evidence/benchmark-1'],
  },
});

test('validateBlueprint accepts a complete immutable hypothesis contract', () => {
  assert.deepEqual(validateBlueprint(validBlueprint()), []);
});

test('validateBlueprint rejects measured results and unsubstantiated verified proof', () => {
  const input = validBlueprint();
  input.outcome.measured = { value: 10, label: 'Tenant result' };
  input.proof = { status: 'verified', summary: '', evidenceLinks: [] };
  assert.deepEqual(validateBlueprint(input), [
    'verified proof requires a summary',
    'verified proof requires evidence',
    'measured KPI belongs to deployment observations, not a reusable blueprint',
  ]);
});

test('deployment parsing is strict about version and status', () => {
  assert.deepEqual(
    validateDeployment({ blueprintId: 'bp', blueprintVersion: 2, appId: 'app', status: 'active' }),
    [],
  );
  assert.deepEqual(
    validateDeployment({
      blueprintId: '',
      blueprintVersion: 0,
      appId: '',
      status: 'bad' as 'active',
    }),
    [
      'blueprint is required',
      'blueprint version must be a positive integer',
      'app is required',
      'invalid deployment status',
    ],
  );
});

const app = {
  pipelineId: 'pl_collections',
  published: true,
  steps: [
    { id: 'd', kind: 'connector-query' as const, label: 'Read', domain: 'loan accounts' },
    {
      id: 'a',
      kind: 'agent' as const,
      label: 'Assess',
      inlineAgent: { systemPrompt: 'Assess', grounded: true },
    },
    { id: 'h', kind: 'human' as const, label: 'Approve' },
    { id: 'o', kind: 'output' as const, label: 'Report', sink: 'report' as const },
  ],
};
const pipeline = {
  id: 'pl_collections',
  name: 'Collections intervention',
  status: 'published',
  dataAllowlist: ['loan accounts'],
};

test('compatibility binds the published App graph to the exact governed pipeline', () => {
  const blueprint = { ...validBlueprint(), tombstonedAt: null };
  assert.deepEqual(evaluateSolutionCompatibility(blueprint, app, pipeline), {
    compatible: true,
    errors: [],
    pipelineId: 'pl_collections',
  });
});

test('compatibility fails closed when publication, graph, domains or pipeline drift', () => {
  const blueprint = { ...validBlueprint(), tombstonedAt: new Date() };
  const result = evaluateSolutionCompatibility(
    blueprint,
    { pipelineId: 'pl_other', published: false, steps: [] },
    { ...pipeline, status: 'draft', dataAllowlist: [] },
  );
  assert.equal(result.compatible, false);
  assert.deepEqual(result.errors, [
    'blueprint is retired',
    'App must be published',
    'pipeline binding changed',
    'bound pipeline must be published',
    'App graph does not read required domain: loan accounts',
    'pipeline does not allow required domain: loan accounts',
    'App graph lacks capability: grounded-inference',
    'App graph lacks capability: human-approval',
    'App graph lacks capability: report-output',
  ]);
});

test('observations own a bounded evidence window and use canonical realized ROI', () => {
  const input = {
    windowStart: new Date('2026-01-01T00:00:00Z'),
    windowEnd: new Date('2026-02-01T00:00:00Z'),
    metricValue: 9.4,
    metricLabel: '30+ DPD rate',
    runsCompleted: 100,
    minutesSavedPerRun: 30,
    loadedCostPerHour: 40,
    actualAiCost: 50,
    evidenceLinks: ['/governance/evidence/window-1'],
  };
  assert.deepEqual(validateObservation(input), []);
  const observed = withRealizedRoi({
    ...input,
    id: 'obs',
    orgId: 'org',
    deploymentId: 'dep',
    createdBy: 'operator@example.com',
    createdAt: new Date('2026-02-02T00:00:00Z'),
  });
  assert.deepEqual(observed.realizedRoi, {
    runsCompleted: 100,
    hoursSaved: 50,
    grossValue: 2000,
    actualAiCost: 50,
    netValue: 1950,
    roiMultiple: 40,
  });
});

test('splitList normalizes comma/newline input and removes duplicates', () => {
  assert.deepEqual(splitList('claims, policies\nclaims,  premiums '), [
    'claims',
    'policies',
    'premiums',
  ]);
});
