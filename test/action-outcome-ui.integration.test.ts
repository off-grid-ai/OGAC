import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OutcomeDetail } from '../src/components/outcomes/OutcomeDetail.tsx';
import { OutcomeEntryForm } from '../src/components/outcomes/OutcomeEntryForm.tsx';
import { OutcomeReadOnlyNotice } from '../src/components/outcomes/OutcomeReadOnlyNotice.tsx';
import { OutcomeTimeline } from '../src/components/outcomes/OutcomeTimeline.tsx';
import type { ActionReceipt } from '../src/lib/action-contract.ts';
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
  approval: { stepId: 'review', evidence: 'Approved by the RM' },
  providerReceipt: { signature: 'signed' },
};

const accepted: ActionOutcomeRecord = {
  id: 'aout_1',
  orgId: 'org_1',
  appId: 'app_1',
  runId: 'run_1',
  stepId: 'act_1',
  receiptIdempotencyKey: receipt.idempotencyKey,
  actionId: receipt.actionId,
  target: receipt.target,
  actionExecutedAt: receipt.executedAt,
  kind: 'observed',
  outcomeCode: 'accepted',
  observedAt: '2026-07-22T10:00:00.000Z',
  source: { kind: 'human', eventId: 'event_1', idempotencyKey: 'source_1' },
  actionReceipt: receipt,
  note: 'Customer accepted during the recorded follow-up.',
  evidenceLinks: ['/solutions/apps/app_1/runs/run_1'],
  measurement: null,
  supersedesId: null,
  recordedBy: 'rm@example.com',
  recordedAt: '2026-07-22T10:01:00.000Z',
};

test('empty result UI never turns a completed action into business success', () => {
  const html = renderToStaticMarkup(
    createElement(OutcomeTimeline, {
      appId: 'app_1',
      runId: 'run_1',
      stepId: 'act_1',
      records: [],
      canManage: true,
    }),
  );
  assert.match(html, /Business result not known/);
  assert.match(html, /The system change is complete/);
  assert.match(html, /Record customer result/);
  assert.match(html, /actions\/act_1\/outcomes\/new/);
  assert.doesNotMatch(html, /Customer converted/);
});

test('entry form uses plain language, all frozen outcomes, and no browser-supplied receipt identity', () => {
  const html = renderToStaticMarkup(
    createElement(OutcomeEntryForm, {
      appId: 'app_1',
      runId: 'run_1',
      stepId: 'act_1',
      eventId: 'event_hidden',
      mode: 'observed',
      initialObservedAt: '2026-07-22T10:00:00.000Z',
    }),
  );
  for (const copy of [
    'The system change is already complete',
    'Customer accepted',
    'Customer declined',
    'Customer converted',
    'Account cured',
    'Claim settled',
    'The result is linked to the exact system change',
    'same result is not added twice',
  ]) {
    assert.match(html, new RegExp(copy));
  }
  assert.doesNotMatch(html, /event_hidden/);
  assert.doesNotMatch(html, /name="(?:orgId|runId|stepId|actionReceipt|eventId)"/);
});

test('detail renders signed system proof beside, not as, the observed business result', () => {
  const html = renderToStaticMarkup(
    createElement(OutcomeDetail, {
      appId: 'app_1',
      records: [accepted],
      observation: accepted,
      canManage: false,
      withdrawalEventId: 'withdraw_hidden',
      withdrawalObservedAt: '2026-07-22T11:00:00.000Z',
    }),
  );
  assert.match(html, /System change completed/);
  assert.match(html, /Execution receipt/);
  assert.match(html, /Business result observed/);
  assert.match(html, /Customer accepted/);
  assert.match(html, /Your role can view business results but cannot record or correct them/);
  assert.doesNotMatch(html, /Withdraw record/);
});

test('direct create and correction journeys have a clear read-only state', () => {
  const html = renderToStaticMarkup(
    createElement(OutcomeReadOnlyNotice, { appId: 'app_1', runId: 'run_1' }),
  );
  assert.match(html, /This record is read-only for your role/);
  assert.match(html, /cannot add, correct or withdraw/);
  assert.match(html, /\/solutions\/apps\/app_1\/runs\/run_1/);
});
