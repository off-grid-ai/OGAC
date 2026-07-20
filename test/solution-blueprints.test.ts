import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateSolutionCompatibility,
  hasAdoptableRuntimeBinding,
  normalizeCompatibilityApp,
  splitList,
  validateBlueprint,
  validateDeployment,
  validateObservation,
  withEstimatedRoi,
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
  adoptable: true,
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

test('catalog adoptability is derived from an exact tenant runtime and declared data binding', () => {
  const blueprint = { ...validBlueprint(), tombstonedAt: null };
  const candidates = [{ app, pipeline }];
  assert.equal(hasAdoptableRuntimeBinding(blueprint, candidates, []), false);
  assert.equal(hasAdoptableRuntimeBinding(blueprint, candidates, ['loan accounts']), true);

  const missingDomain = evaluateSolutionCompatibility(blueprint, app, pipeline, []);
  assert.equal(missingDomain.compatible, false);
  assert.match(
    missingDomain.errors.join('\n'),
    /tenant has no declared data domain: loan accounts/,
  );
});

test('legacy seeded App JSONB is normalized before solution compatibility evaluation', () => {
  const legacy = normalizeCompatibilityApp({
    pipelineId: 'pl_collections',
    published: true,
    steps: [
      {
        id: 'read',
        kind: 'connector-query',
        label: 'Read loans',
        config: { domain: 'loan accounts', op: 'read' },
      },
      {
        id: 'assess',
        kind: 'agent',
        label: 'Assess',
        config: { inlineAgent: { systemPrompt: 'Assess delinquency.', grounded: true } },
      },
      { id: 'approve', kind: 'human', label: 'Approve', config: {} },
      { id: 'report', kind: 'output', label: 'Report', config: { sink: 'report' } },
    ],
  });

  assert.deepEqual(
    evaluateSolutionCompatibility({ ...validBlueprint(), tombstonedAt: null }, legacy, pipeline),
    { compatible: true, errors: [], pipelineId: 'pl_collections' },
  );
  assert.doesNotThrow(() =>
    evaluateSolutionCompatibility(
      { ...validBlueprint(), tombstonedAt: null },
      normalizeCompatibilityApp({
        published: true,
        steps: [{ id: 'read', kind: 'connector-query', config: {} }],
      }),
      null,
    ),
  );
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

test('observations own a bounded claim window and estimate ROI from canonical run facts', () => {
  const input = {
    windowStart: new Date('2026-01-01T00:00:00Z'),
    windowEnd: new Date('2026-02-01T00:00:00Z'),
    claimedMetricValue: 9.4,
    claimLabel: '30+ DPD rate',
    estimatedMinutesSavedPerRun: 30,
    estimatedLoadedCostPerHour: 40,
    evidenceLinks: ['/governance/evidence/window-1'],
  };
  assert.deepEqual(validateObservation(input, new Date('2026-02-02T00:00:00Z')), []);
  const observed = withEstimatedRoi({
    ...input,
    id: 'obs',
    orgId: 'org',
    deploymentId: 'dep',
    runIds: Array.from({ length: 100 }, (_, index) => `run-${index}`),
    runsCompleted: 100,
    actualAiCost: 50,
    createdBy: 'operator@example.com',
    createdAt: new Date('2026-02-02T00:00:00Z'),
  });
  assert.deepEqual(observed.estimatedRoi, {
    runsCompleted: 100,
    hoursSaved: 50,
    grossValue: 2000,
    actualAiCost: 50,
    netValue: 1950,
    roiMultiple: 40,
  });
});

test('observation validation rejects unsupported and future operator claims', () => {
  assert.deepEqual(
    validateObservation(
      {
        windowStart: new Date('2026-02-01T00:00:00Z'),
        windowEnd: new Date('2026-03-01T00:00:00Z'),
        claimedMetricValue: 9.4,
        claimLabel: '',
        estimatedMinutesSavedPerRun: 30,
        estimatedLoadedCostPerHour: 40,
        evidenceLinks: [],
      },
      new Date('2026-02-15T00:00:00Z'),
    ),
    [
      'window end cannot be in the future',
      'claim label is required',
      'operator claims require supporting evidence',
    ],
  );
});

test('splitList normalizes comma/newline input and removes duplicates', () => {
  assert.deepEqual(splitList('claims, policies\nclaims,  premiums '), [
    'claims',
    'policies',
    'premiums',
  ]);
});
