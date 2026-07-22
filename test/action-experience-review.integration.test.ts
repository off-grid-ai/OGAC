import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionReviewEvidence } from '@/components/actions/ActionReviewEvidence';
import {
  confirmOnPremActionImpact,
  planActionImpact,
  type ActionReceipt,
} from '@/lib/action-contract';

const impact = confirmOnPremActionImpact(
  planActionImpact({
    id: 'action-1',
    kind: 'action',
    actionId: 'crm.create-task',
    connectorId: 'crm-main',
    approvalStepId: 'review-1',
    command: { opportunityId: 'opp-42' },
  }),
);

const receipt: ActionReceipt = {
  actionId: 'crm.create-task',
  label: 'Create CRM follow-up task',
  system: 'CRM',
  orgId: 'org-bharat',
  runId: 'run-1',
  stepId: 'action-1',
  connectorId: 'crm-main',
  target: 'opp-42',
  idempotencyKey: 'action:run-1:action-1',
  status: 'executed',
  executedAt: '2026-07-22T20:41:00.000Z',
  approval: { stepId: 'review-1', evidence: 'Approved by the branch manager' },
  providerReceipt: { signature: 'signed' },
};

test('review shows exact action impact before Approve', () => {
  const html = renderToStaticMarkup(
    createElement(ActionReviewEvidence, {
      impact,
      receipt: null,
      canApprove: true,
      boundaryReady: true,
    }),
  );

  assert.match(html, /Before this runs/);
  assert.match(html, /Creates one record in CRM/);
  assert.match(html, /No data leaves your organization/);
  assert.match(html, /You can approve this change/);
  assert.match(html, /Signed execution receipt/);
  assert.doesNotMatch(html, /Execution receipt/);
});

test('review replaces the preview with the retained execution receipt after completion', () => {
  const html = renderToStaticMarkup(
    createElement(ActionReviewEvidence, {
      impact,
      receipt,
      canApprove: false,
      boundaryReady: true,
    }),
  );

  assert.match(html, /Execution receipt/);
  assert.match(html, /Completed/);
  assert.match(html, /Receipt action:run-1:action-1/);
  assert.match(html, /Approved by the branch manager/);
  assert.doesNotMatch(html, /Before this runs/);
});

test('review states when the action connection blocks approval', () => {
  const unresolved = {
    ...impact,
    egress: {
      classification: 'internal-connection-required' as const,
      dataLeavesOrganisation: null,
      dlp: 'boundary-verification-required' as const,
    },
  };
  const html = renderToStaticMarkup(
    createElement(ActionReviewEvidence, {
      impact: unresolved,
      receipt: null,
      canApprove: false,
      boundaryReady: false,
    }),
  );

  assert.match(html, /Select an approved internal connection to verify the boundary/);
  assert.match(html, /Approval is blocked until the connection is fixed/);
});
