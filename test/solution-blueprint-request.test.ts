import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseBlueprintInput,
  parseBlueprintPatch,
  parseDeploymentInput,
} from '../src/lib/solution-blueprint-request.ts';

test('blueprint request parser shapes nested KPI, ROI and proof inputs without trusting JSON', () => {
  const parsed = parseBlueprintInput({
    title: 'Claims',
    summary: 'Fast',
    industry: 'Insurance',
    process: 'Claims',
    businessOwner: 'CCO',
    requiredDataDomains: ['claims', 1],
    requiredTools: ['approval'],
    governedPipeline: 'Claims',
    sourceTemplateKey: 'claims',
    outcome: {
      metricName: 'Throughput',
      metricUnit: 'day',
      direction: 'increase',
      measurementWindow: '30d',
      baseline: { value: '5', label: 'before' },
      target: { value: 50, label: 'after' },
      measured: null,
      roi: {
        currency: 'USD',
        annualBenefit: '100',
        implementationCost: 10,
        annualOperatingCost: 5,
        rationale: 'capacity',
      },
    },
    proof: {
      version: '1',
      provenDeployments: '3',
      summary: 'proven',
      evidenceLinks: ['/evidence', 2],
    },
  });
  assert.equal(parsed?.outcome.baseline.value, 5);
  assert.deepEqual(parsed?.requiredDataDomains, ['claims']);
  assert.equal(parsed?.proof.provenDeployments, 3);
  assert.deepEqual(parsed?.proof.evidenceLinks, ['/evidence']);
  assert.equal(parseBlueprintInput(null), null);
});

test('patch parser includes only present mutable fields', () => {
  assert.deepEqual(parseBlueprintPatch({ title: 'New', requiredTools: ['tool'] }), {
    title: 'New',
    requiredTools: ['tool'],
  });
  assert.deepEqual(parseBlueprintPatch([]), null);
});

test('deployment parser normalizes status and rejects non-object bodies', () => {
  assert.deepEqual(
    parseDeploymentInput({
      blueprintId: 'bp',
      appId: 'app',
      status: 'paused',
      evidenceLinks: ['/e'],
    }),
    { blueprintId: 'bp', appId: 'app', status: 'paused', evidenceLinks: ['/e'] },
  );
  assert.equal(parseDeploymentInput('bad'), null);
  assert.equal(
    parseDeploymentInput({ blueprintId: 'bp', appId: 'app', status: 'unknown' })?.status,
    'active',
  );
});
