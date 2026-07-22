import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionImpactSummary } from '@/components/actions/ActionImpactSummary';
import { ActionExecutionReceipt } from '@/components/actions/ActionExecutionReceipt';
import { planActionImpact, type ActionReceipt } from '@/lib/action-contract';

test('action impact explains the external change, data boundary, approval and retained proof', () => {
  const impact = planActionImpact({
    id: 'action-1',
    kind: 'action',
    actionId: 'crm.create-task',
    connectorId: 'crm-main',
    command: { opportunityId: 'opp-priya' },
    approvalStepId: 'approve-1',
  });

  const html = renderToStaticMarkup(
    createElement(ActionImpactSummary, {
      impact,
      approver: 'Branch manager or campaign owner',
      evidence: ['Approval decision', 'Fields sent after masking', 'CRM record identifier'],
    }),
  );

  assert.match(html, /Before this runs/);
  assert.match(html, /Create CRM follow-up task for opp-priya/);
  assert.match(html, /CRM/);
  assert.match(html, /Data leaving your organization/);
  assert.match(html, /No data leaves your organization/);
  assert.match(html, /Approval required before execution/);
  assert.match(html, /Branch manager or campaign owner/);
  assert.match(html, /CRM record identifier/);
  assert.match(html, /md:grid-cols-2/);
  assert.doesNotMatch(html, /Kestra|Temporal|sink payload|plugin/i);
});

test('action impact states when no data leaves and no approval is needed', () => {
  const impact = {
    ...planActionImpact({
      id: 'action-1',
      kind: 'action' as const,
      actionId: 'crm.update-task' as const,
      connectorId: 'crm-main',
      command: { taskId: 'task-1' },
      approvalStepId: 'approve-1',
    }),
    sideEffects: [],
    approval: { required: false, status: 'not-required' as const },
  };

  const html = renderToStaticMarkup(createElement(ActionImpactSummary, { impact }));

  assert.match(html, /No system fields change/);
  assert.match(html, /No data leaves your organization/);
  assert.match(html, /No human approval is required/);
  assert.match(html, /decision and execution result are retained/i);
});

test('completed action receipt keeps the execution proof visible', () => {
  const receipt: ActionReceipt = {
    actionId: 'crm.create-task',
    label: 'CRM follow-up created',
    system: 'CRM',
    orgId: 'org-bharat',
    runId: 'run-1',
    stepId: 'action-1',
    connectorId: 'crm-main',
    target: 'crm-8421',
    idempotencyKey: 'act_01JY7',
    status: 'executed',
    executedAt: '22 Jul 2026, 20:41',
    approval: {
      stepId: 'approve-1',
      evidence: 'Approved by the branch manager',
      reviewer: 'Branch Manager',
    },
    providerReceipt: { id: 'crm-8421' },
  };

  const html = renderToStaticMarkup(createElement(ActionExecutionReceipt, { receipt }));

  assert.match(html, /Execution receipt/);
  assert.match(html, /Completed/);
  assert.match(html, /Receipt act_01JY7/);
  assert.match(html, /Branch Manager/);
  assert.match(html, /Approved by the branch manager/);
  assert.match(html, /Signed provider receipt/);
  assert.match(html, /Retained evidence/);
});

test('replayed receipt states that the retained result prevented a duplicate change', () => {
  const replayed = renderToStaticMarkup(
    createElement(ActionExecutionReceipt, {
      receipt: {
        ...receiptFixture(),
        status: 'replayed',
      },
    }),
  );
  assert.match(replayed, /role="status"/);
  assert.match(replayed, /Completed from the retained receipt/);
  assert.match(replayed, /Signed provider receipt/);
});

function receiptFixture(): ActionReceipt {
  return {
    actionId: 'crm.create-task',
    label: 'Create CRM follow-up task',
    system: 'CRM',
    orgId: 'org-bharat',
    runId: 'run-1',
    stepId: 'action-1',
    connectorId: 'crm-main',
    target: 'crm-8421',
    idempotencyKey: 'act_01JY7',
    status: 'executed',
    executedAt: '22 Jul 2026, 20:41',
    approval: { stepId: 'approve-1', evidence: 'Approved' },
    providerReceipt: { id: 'crm-8421' },
  };
}
