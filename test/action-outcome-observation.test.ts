import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { ActionReceipt } from '@/lib/action-contract';
import type { ActionOutcomeMutationInput, ActionOutcomeRecord } from '@/lib/action-outcome-contract';
import {
  deriveActionOutcomeIdempotencyKey,
  isExactOutcomeReplay,
  validateCanonicalOutcomeTiming,
} from '@/lib/action-outcome-observation';

const RECEIPT: ActionReceipt = {
  actionId: 'crm.create-task',
  label: 'Create CRM follow-up task',
  system: 'CRM',
  orgId: 'org_bharat',
  runId: 'run_1',
  stepId: 'act',
  connectorId: 'crm_bharat',
  target: 'opp_101',
  idempotencyKey: 'action:receipt-101',
  status: 'executed',
  executedAt: '2026-07-22T10:00:00.000Z',
  approval: { stepId: 'review', evidence: 'approved', reviewer: 'manager@bank.local' },
  providerReceipt: { signature: 'signed' },
};

const INPUT: ActionOutcomeMutationInput = {
  runId: 'run_1',
  stepId: 'act',
  kind: 'observed',
  outcomeCode: 'accepted',
  observedAt: '2026-07-22T10:05:00.000Z',
  source: { kind: 'human', eventId: 'customer-response-1' },
  note: 'Customer accepted the offer.',
  evidenceLinks: ['/crm/opportunities/opp_101'],
  measurement: { metricName: 'Offer accepted', metricUnit: 'boolean', resultValue: 1 },
};

function record(input: ActionOutcomeMutationInput = INPUT): ActionOutcomeRecord {
  const idempotencyKey = deriveActionOutcomeIdempotencyKey(
    RECEIPT.orgId,
    RECEIPT.idempotencyKey,
    input.source,
  );
  return {
    id: 'aout_1',
    orgId: RECEIPT.orgId,
    appId: 'app_cross_sell',
    runId: input.runId,
    stepId: input.stepId,
    receiptIdempotencyKey: RECEIPT.idempotencyKey,
    actionId: RECEIPT.actionId,
    target: RECEIPT.target,
    actionExecutedAt: RECEIPT.executedAt,
    actionReceipt: RECEIPT,
    kind: input.kind,
    outcomeCode: input.outcomeCode ?? null,
    observedAt: new Date(input.observedAt).toISOString(),
    source: { ...input.source, idempotencyKey },
    note: input.note,
    evidenceLinks: input.evidenceLinks,
    measurement: input.measurement ?? null,
    supersedesId: input.supersedesId ?? null,
    recordedBy: 'operator@bank.local',
    recordedAt: '2026-07-22T10:06:00.000Z',
  };
}

test('derives the frozen receipt/source sha256 without exposing browser-owned replay semantics', () => {
  const expected = createHash('sha256')
    .update('org_bharat|action:receipt-101|human|customer-response-1')
    .digest('hex');
  assert.equal(
    deriveActionOutcomeIdempotencyKey('org_bharat', RECEIPT.idempotencyKey, INPUT.source),
    expected,
  );
  assert.notEqual(
    deriveActionOutcomeIdempotencyKey('org_other', RECEIPT.idempotencyKey, INPUT.source),
    expected,
  );
});

test('validates the business timestamp against the canonical action receipt and wall clock', () => {
  assert.deepEqual(
    validateCanonicalOutcomeTiming(INPUT.observedAt, RECEIPT, new Date('2026-07-22T11:00:00Z')),
    [],
  );
  assert.deepEqual(
    validateCanonicalOutcomeTiming('2026-07-22T09:59:59Z', RECEIPT, new Date('2026-07-22T11:00:00Z')),
    ['business outcome cannot predate the governed action'],
  );
  assert.deepEqual(
    validateCanonicalOutcomeTiming('2026-07-22T11:00:01Z', RECEIPT, new Date('2026-07-22T11:00:00Z')),
    ['business outcome cannot be in the future'],
  );
  assert.deepEqual(
    validateCanonicalOutcomeTiming(INPUT.observedAt, { ...RECEIPT, executedAt: 'invalid' }),
    ['canonical action receipt has an invalid execution time'],
  );
});

test('accepts semantic retries and rejects reuse of an event id for changed evidence', () => {
  assert.equal(isExactOutcomeReplay(record(), INPUT), true);
  assert.equal(
    isExactOutcomeReplay(
      record({ ...INPUT, evidenceLinks: ['/a', '/b'] }),
      { ...INPUT, evidenceLinks: ['/b', '/a'] },
    ),
    true,
  );
  assert.equal(isExactOutcomeReplay(record(), { ...INPUT, outcomeCode: 'converted' }), false);
  assert.equal(isExactOutcomeReplay(record(), { ...INPUT, note: 'Changed claim' }), false);
  assert.equal(
    isExactOutcomeReplay(record(), {
      ...INPUT,
      measurement: { ...INPUT.measurement!, resultValue: 0 },
    }),
    false,
  );
});
