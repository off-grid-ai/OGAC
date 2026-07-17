import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeOutcome, validateOutcomeContract, type OutcomeContract } from '../src/lib/outcome-contract.ts';

const contract = (patch: Partial<OutcomeContract> = {}): OutcomeContract => ({
  metricName: 'Cases processed per day',
  metricUnit: 'cases/day',
  direction: 'increase',
  measurementWindow: '30 days',
  baseline: { value: 500, label: 'Current manual throughput' },
  target: { value: 5000, label: 'Automated throughput' },
  measured: { value: 3200, label: 'Production average' },
  roi: {
    currency: 'USD',
    annualBenefit: 900_000,
    implementationCost: 100_000,
    annualOperatingCost: 50_000,
    rationale: 'Same workforce processes ten times the claims.',
  },
  ...patch,
});

test('summarizeOutcome derives target lift, measured progress, net value and payback', () => {
  assert.deepEqual(summarizeOutcome(contract()), {
    targetChangePct: 900,
    measuredProgressPct: 60,
    annualNetBenefit: 850_000,
    roiMultiple: 6,
    paybackMonths: 1.41,
  });
});

test('summarizeOutcome handles decrease contracts and zero-cost hypotheses', () => {
  const result = summarizeOutcome(
    contract({
      direction: 'decrease',
      baseline: { value: 12, label: 'Baseline delinquency' },
      target: { value: 8, label: 'Target delinquency' },
      measured: { value: 10, label: 'Current delinquency' },
      roi: { currency: 'USD', annualBenefit: 20, implementationCost: 0, annualOperatingCost: 0, rationale: 'Avoided loss' },
    }),
  );
  assert.equal(result.targetChangePct, 33.33);
  assert.equal(result.measuredProgressPct, 50);
  assert.equal(result.roiMultiple, null);
  assert.equal(result.paybackMonths, 0);
});

test('summarizeOutcome returns honest nulls when percentages or payback are undefined', () => {
  const result = summarizeOutcome(
    contract({
      baseline: { value: 0, label: 'No current capacity' },
      target: { value: 5, label: 'Target' },
      measured: null,
      roi: { currency: 'USD', annualBenefit: 5, implementationCost: 10, annualOperatingCost: 10, rationale: 'Capability unlock' },
    }),
  );
  assert.equal(result.targetChangePct, null);
  assert.equal(result.measuredProgressPct, null);
  assert.equal(result.annualNetBenefit, -5);
  assert.equal(result.paybackMonths, null);
});

test('validateOutcomeContract rejects missing fields, impossible direction and unsafe numbers', () => {
  const invalid = contract({
    metricName: ' ',
    metricUnit: '',
    measurementWindow: '',
    baseline: { value: Number.NaN, label: '' },
    target: { value: 1, label: '' },
    measured: { value: Infinity, label: '' },
    roi: { currency: '', annualBenefit: -1, implementationCost: Number.NaN, annualOperatingCost: 0, rationale: '' },
  });
  assert.deepEqual(validateOutcomeContract(invalid), [
    'metric name is required',
    'metric unit is required',
    'measurement window is required',
    'baseline label is required',
    'target label is required',
    'measured label is required',
    'KPI values must be finite',
    'ROI amounts must be finite and non-negative',
    'ROI currency is required',
    'ROI rationale is required',
  ]);
  assert.deepEqual(
    validateOutcomeContract(contract({ target: { value: 100, label: 'Wrong-way target' } })),
    ['an increase target must exceed its baseline'],
  );
});
