import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareOutcomeWindows,
  effectiveActionOutcomes,
  summarizeOutcomeWindow,
  type ActionOutcomeMutationInput,
  type ActionOutcomeRecord,
  validateActionOutcomeMutation,
} from '@/lib/action-outcome-contract';

const baseInput: ActionOutcomeMutationInput = {
  runId: 'apprun_123',
  stepId: 'write_crm',
  kind: 'observed',
  outcomeCode: 'accepted',
  observedAt: '2026-07-22T10:00:00.000Z',
  source: { kind: 'human', eventId: 'mutation_123' },
  note: 'Customer accepted the recommended offer.',
  evidenceLinks: ['/solutions/apps/app_1/runs/apprun_123'],
};

function record(
  id: string,
  outcomeCode: ActionOutcomeRecord['outcomeCode'],
  overrides: Partial<ActionOutcomeRecord> = {},
): ActionOutcomeRecord {
  return {
    id,
    orgId: 'org_bank',
    runId: 'apprun_123',
    stepId: 'write_crm',
    receiptIdempotencyKey: 'action:receipt-1',
    actionId: 'crm.create-task',
    target: 'opp_101',
    actionExecutedAt: '2026-07-22T09:00:00.000Z',
    kind: 'observed',
    outcomeCode,
    observedAt: '2026-07-22T10:00:00.000Z',
    source: {
      kind: 'human',
      eventId: `event_${id}`,
      idempotencyKey: `source_${id}`,
    },
    note: 'Observed result',
    evidenceLinks: [],
    measurement: null,
    supersedesId: null,
    recordedBy: 'operator@bank.test',
    recordedAt: '2026-07-22T10:01:00.000Z',
    ...overrides,
  };
}

test('validates an append-only observed business result', () => {
  assert.deepEqual(validateActionOutcomeMutation(baseInput), []);
});

test('requires correction and withdrawal records to identify the retained fact', () => {
  assert.deepEqual(
    validateActionOutcomeMutation({ ...baseInput, kind: 'corrected' }),
    ['correction must identify the observation it corrects'],
  );
  assert.deepEqual(
    validateActionOutcomeMutation({
      ...baseInput,
      kind: 'withdrawn',
      outcomeCode: undefined,
    }),
    ['withdrawal must identify the observation it withdraws'],
  );
});

test('refuses malformed identity, source, evidence, dates and measurements', () => {
  const errors = validateActionOutcomeMutation({
    ...baseInput,
    runId: '../wrong',
    stepId: '',
    observedAt: 'later',
    source: { kind: 'import', eventId: 'contains spaces' },
    note: '',
    evidenceLinks: ['javascript:alert(1)'],
    measurement: {
      metricName: '',
      metricUnit: '',
      baselineValue: Number.NaN,
      resultValue: Number.POSITIVE_INFINITY,
    },
  });
  assert.deepEqual(errors, [
    'run id is invalid',
    'step id is invalid',
    'source event id is invalid',
    'observed time is invalid',
    'a plain-language note is required',
    'evidence links must be relative or HTTP URLs',
    'measurement name is required',
    'measurement unit is required',
    'measurement result must be finite',
    'measurement baseline must be finite',
  ]);
});

test('accepted then converted are independent effective facts', () => {
  const accepted = record('out_accepted', 'accepted');
  const converted = record('out_converted', 'converted');
  assert.deepEqual(effectiveActionOutcomes([accepted, converted]), [accepted, converted]);
});

test('correction and withdrawal retain history while removing superseded facts from current truth', () => {
  const rejected = record('out_wrong', 'rejected');
  const corrected = record('out_fixed', 'accepted', {
    kind: 'corrected',
    supersedesId: rejected.id,
  });
  const withdrawn = record('out_withdraw', null, {
    kind: 'withdrawn',
    supersedesId: corrected.id,
  });
  assert.deepEqual(effectiveActionOutcomes([rejected, corrected]), [corrected]);
  assert.deepEqual(effectiveActionOutcomes([rejected, corrected, withdrawn]), []);
});

test('summarizes baseline versus result over canonical action receipt denominators', () => {
  const baseline = summarizeOutcomeWindow(
    ['receipt_a', 'receipt_b'],
    [
      record('out_a', 'converted', { receiptIdempotencyKey: 'receipt_a' }),
      record('out_outside', 'converted', { receiptIdempotencyKey: 'receipt_outside' }),
    ],
    new Set(['converted']),
  );
  const result = summarizeOutcomeWindow(
    ['receipt_c', 'receipt_d'],
    [
      record('out_c1', 'accepted', { receiptIdempotencyKey: 'receipt_c' }),
      record('out_c2', 'converted', { receiptIdempotencyKey: 'receipt_c' }),
      record('out_d', 'rejected', { receiptIdempotencyKey: 'receipt_d' }),
    ],
    new Set(['converted']),
  );
  assert.equal(baseline.successRatePct, 50);
  assert.equal(result.observationRatePct, 100);
  assert.equal(result.successRatePct, 50);
  assert.equal(result.counts.accepted, 1);
  assert.equal(result.counts.converted, 1);
  assert.equal(result.counts.rejected, 1);
  assert.equal(compareOutcomeWindows(baseline, result).successRateChangePctPoints, 0);
});

test('empty action windows never fabricate rates', () => {
  const empty = summarizeOutcomeWindow([], [], new Set(['settled']));
  assert.equal(empty.observationRatePct, null);
  assert.equal(empty.successRatePct, null);
});
