import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseBlueprintInput,
  parseBlueprintPatch,
  parseDeploymentInput,
  parseObservationInput,
} from '../src/lib/solution-blueprint-request.ts';

test('blueprint request parser preserves invalid enums for fail-closed validation', () => {
  const parsed = parseBlueprintInput({
    title: 'Claims',
    requiredDataDomains: ['claims', 2],
    requiredCapabilities: ['grounded-inference'],
    requiredPipelineName: 'Claims',
    outcome: {
      direction: 'sideways',
      baseline: { value: '10', label: 'Before' },
      target: { value: 12, label: 'After' },
      roi: { annualBenefit: '20' },
    },
    proof: { status: 'invented', evidenceLinks: ['/evidence', 2] },
  });
  assert.equal(parsed?.outcome.direction, 'sideways');
  assert.equal(parsed?.outcome.baseline.value, 10);
  assert.deepEqual(parsed?.requiredDataDomains, ['claims']);
  assert.equal(parsed?.proof.status, 'invented');
  assert.deepEqual(parsed?.proof.evidenceLinks, ['/evidence']);
  assert.equal(parseBlueprintInput(null), null);
});

test('blueprint patch only includes explicitly supplied fields', () => {
  assert.deepEqual(
    parseBlueprintPatch({ title: 'New', requiredCapabilities: ['human-approval'] }),
    { title: 'New', requiredCapabilities: ['human-approval'] },
  );
  assert.deepEqual(parseBlueprintPatch([]), null);
});

test('deployment parser never defaults an invalid status to active', () => {
  assert.deepEqual(
    parseDeploymentInput({ blueprintId: 'bp', blueprintVersion: '3', appId: 'app', status: 'bad' }),
    { blueprintId: 'bp', blueprintVersion: 3, appId: 'app', status: 'bad' },
  );
});

test('observation parser accepts claims and assumptions but ignores canonical run facts', () => {
  const parsed = parseObservationInput({
    windowStart: '2026-01-01T00:00:00Z',
    windowEnd: '2026-02-01T00:00:00Z',
    claimedMetricValue: '9.4',
    claimLabel: '30+ DPD',
    runsCompleted: '100',
    estimatedMinutesSavedPerRun: '15',
    estimatedLoadedCostPerHour: 50,
    actualAiCost: 12,
    evidenceLinks: ['/e'],
  });
  assert.equal(parsed?.claimedMetricValue, 9.4);
  assert.equal('runsCompleted' in (parsed ?? {}), false);
  assert.equal('actualAiCost' in (parsed ?? {}), false);
  assert.equal(parsed?.windowStart.toISOString(), '2026-01-01T00:00:00.000Z');
});
