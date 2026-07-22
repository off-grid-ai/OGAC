import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActionReceipt } from '../src/lib/action-contract.ts';
import {
  actionOutcomeCopy,
  presentActionOutcomes,
  presentOutcomeMeasurement,
} from '../src/lib/action-outcome-presenter.ts';
import type { ActionOutcomeRecord } from '../src/lib/action-outcome-contract.ts';

const receipt: ActionReceipt = {
  actionId: 'crm.create-task',
  label: 'Create CRM follow-up task',
  system: 'CRM',
  orgId: 'org_1',
  runId: 'run_1',
  stepId: 'act_1',
  connectorId: 'crm',
  target: 'opp_1',
  idempotencyKey: 'receipt_1',
  status: 'executed',
  executedAt: '2026-07-22T09:00:00.000Z',
  approval: { stepId: 'review', evidence: 'approved' },
  providerReceipt: { signature: 'signed' },
};

function record(
  id: string,
  outcomeCode: ActionOutcomeRecord['outcomeCode'],
  patch: Partial<ActionOutcomeRecord> = {},
): ActionOutcomeRecord {
  return {
    id,
    orgId: 'org_1',
    appId: 'app_1',
    runId: 'run_1',
    stepId: 'act_1',
    receiptIdempotencyKey: 'receipt_1',
    actionId: 'crm.create-task',
    target: 'opp_1',
    actionExecutedAt: receipt.executedAt,
    kind: 'observed',
    outcomeCode,
    observedAt: '2026-07-22T10:00:00.000Z',
    source: { kind: 'human', eventId: id, idempotencyKey: `key_${id}` },
    actionReceipt: receipt,
    note: 'Recorded result.',
    evidenceLinks: ['/operations/runs/run_1'],
    measurement: null,
    supersedesId: null,
    recordedBy: 'rm@example.com',
    recordedAt: '2026-07-22T10:01:00.000Z',
    ...patch,
  };
}

test('presenter keeps system completion separate when no business result exists', () => {
  assert.deepEqual(presentActionOutcomes([]), {
    current: null,
    currentCopy: null,
    history: [],
    nextAction: { kind: 'record-result', label: 'Record customer result' },
  });
});

test('presenter uses customer language and offers conversion after acceptance', () => {
  const accepted = record('accepted', 'accepted');
  const result = presentActionOutcomes([accepted]);
  assert.equal(result.current, accepted);
  assert.deepEqual(result.currentCopy, {
    label: 'Customer accepted',
    detail: 'Customer accepted the recommendation. Conversion has not been confirmed.',
  });
  assert.deepEqual(result.nextAction, { kind: 'record-conversion', label: 'Record conversion' });
  assert.equal(actionOutcomeCopy('rejected').label, 'Customer declined');
  assert.equal(actionOutcomeCopy('cured').label, 'Account cured');
  assert.equal(actionOutcomeCopy('settled').label, 'Claim settled');
});

test('accepted and converted remain independent facts while converted becomes current', () => {
  const accepted = record('accepted', 'accepted');
  const converted = record('converted', 'converted', {
    observedAt: '2026-07-23T10:00:00.000Z',
    recordedAt: '2026-07-23T10:01:00.000Z',
  });
  const result = presentActionOutcomes([accepted, converted]);
  assert.equal(result.current?.id, 'converted');
  assert.equal(result.history.length, 2);
  assert.equal(result.nextAction, null);
});

test('correction and withdrawal retain history but remove superseded facts from current state', () => {
  const original = record('original', 'accepted');
  const correction = record('correction', 'rejected', {
    kind: 'corrected',
    supersedesId: 'original',
    recordedAt: '2026-07-22T11:00:00.000Z',
  });
  const withdrawal = record('withdrawal', null, {
    kind: 'withdrawn',
    supersedesId: 'correction',
    note: 'Source record was reversed.',
    recordedAt: '2026-07-22T12:00:00.000Z',
  });
  const result = presentActionOutcomes([original, correction, withdrawal]);
  assert.equal(result.current, null);
  assert.deepEqual(
    result.history.map((item) => [item.record.id, item.stateLabel, item.canCorrect]),
    [
      ['original', 'Corrected', false],
      ['correction', 'Withdrawn', false],
      ['withdrawal', 'Withdrawn', false],
    ],
  );
  assert.deepEqual(result.nextAction, { kind: 'record-result', label: 'Record customer result' });
});

test('a withdrawal labels the original fact withdrawn rather than corrected', () => {
  const original = record('converted', 'converted');
  const withdrawal = record('withdrawal', null, {
    kind: 'withdrawn',
    supersedesId: original.id,
    note: 'The CRM conversion was reversed.',
    recordedAt: '2026-07-22T12:00:00.000Z',
  });

  const result = presentActionOutcomes([original, withdrawal]);
  assert.deepEqual(
    result.history.map((item) => [item.record.id, item.stateLabel]),
    [
      ['converted', 'Withdrawn'],
      ['withdrawal', 'Withdrawn'],
    ],
  );
});

test('measurement presentation derives before, after and change without inventing a percentage', () => {
  assert.deepEqual(
    presentOutcomeMeasurement({
      metricName: 'Incremental revenue',
      metricUnit: 'INR',
      baselineValue: 10_000,
      resultValue: 25_000,
    }),
    {
      metricName: 'Incremental revenue',
      baselineValue: '10,000 INR',
      resultValue: '25,000 INR',
      changeValue: '+15,000 INR',
      changeDetail: '+150% from baseline',
    },
  );
  assert.deepEqual(
    presentOutcomeMeasurement({
      metricName: 'Incremental revenue',
      metricUnit: 'INR',
      baselineValue: 0,
      resultValue: 500,
    }),
    {
      metricName: 'Incremental revenue',
      baselineValue: '0 INR',
      resultValue: '500 INR',
      changeValue: '+500 INR',
      changeDetail: 'Percentage change is not available from a zero baseline.',
    },
  );
  assert.deepEqual(
    presentOutcomeMeasurement({
      metricName: 'Incremental revenue',
      metricUnit: 'INR',
      resultValue: 500,
    }),
    {
      metricName: 'Incremental revenue',
      baselineValue: 'Not recorded',
      resultValue: '500 INR',
      changeValue: 'Not available',
      changeDetail: 'Add a baseline to calculate the change.',
    },
  );
});
