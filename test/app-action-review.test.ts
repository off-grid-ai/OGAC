import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planActionImpact, type ActionReceipt } from '@/lib/action-contract';
import type { ActionStep } from '@/lib/app-model';
import type { AppRunView } from '@/lib/app-runs-view';
import { actionEvidenceForReview, buildReviewDetail, type ReviewAppLike } from '@/lib/review-inbox';

const ACTION: ActionStep = {
  id: 'act',
  label: 'Create follow-up',
  kind: 'action',
  actionId: 'crm.create-task',
  connectorId: 'crm_bharat',
  approvalStepId: 'review',
  command: {
    subject: 'Call eligible customer',
    useCase: 'bank-cross-sell',
    kind: 'call',
    opportunityId: 'opp_101',
  },
};
const APP: ReviewAppLike = {
  id: 'app',
  title: 'Cross-sell follow-up',
  summary: 'Find and action eligible opportunities',
  ownerId: 'maker',
  policy: { appId: 'app', orgId: 'org_bharat', ownerId: 'maker', actions: {} },
  steps: [{ id: 'review', label: 'RM review', kind: 'human' }, ACTION],
  actionConnectorBoundaries: { crm_bharat: 'internal' },
};
const RUN: AppRunView = {
  id: 'run',
  appId: 'app',
  status: 'awaiting_human',
  input: { opportunityId: 'opp_101' },
  steps: [{ id: 'review', kind: 'human', label: 'RM review', status: 'awaiting_human' }],
  outcome: 'Eligible opportunity',
  provenance: null,
  startedAt: null,
  finishedAt: null,
};

test('review detail derives the exact downstream action impact from the saved App', () => {
  const evidence = actionEvidenceForReview(RUN, APP);
  assert.equal(evidence.actionReceipt, null);
  assert.equal(evidence.actionImpact?.actionId, 'crm.create-task');
  assert.equal(evidence.actionImpact?.target, 'opp_101');
  assert.equal(evidence.actionImpact?.summary.endsWith('Nothing has been changed.'), true);
  assert.equal(evidence.actionImpact?.egress.dataLeavesOrganisation, false);
  assert.equal(evidence.actionBoundaryReady, true);

  const detail = buildReviewDetail(RUN, APP, null, {
    userId: 'manager',
    role: 'admin',
    department: null,
    orgId: 'org_bharat',
  });
  assert.deepEqual(detail.actionImpact, evidence.actionImpact);
  assert.equal(detail.actionReceipt, null);
  assert.equal(detail.canApprove, true);
});

test('review cannot approve an action whose connector is external or missing', () => {
  for (const boundary of ['external', 'missing'] as const) {
    const app = {
      ...APP,
      actionConnectorBoundaries: { crm_bharat: boundary },
    };
    const detail = buildReviewDetail(RUN, app, null, {
      userId: 'manager',
      role: 'admin',
      department: null,
      orgId: 'org_bharat',
    });
    assert.equal(detail.canApprove, false);
    assert.equal(detail.actionBoundaryReady, false);
    assert.match(
      detail.approveBlockedReason ?? '',
      boundary === 'external' ? /on-prem CRM/ : /unavailable/,
    );
    assert.equal(detail.actionImpact?.egress.dataLeavesOrganisation, null);
  }
});

test('review projection returns retained real receipt without fabricating execution', () => {
  const receipt: ActionReceipt = {
    actionId: 'crm.create-task',
    label: 'Create CRM follow-up task',
    system: 'CRM',
    orgId: 'org_bharat',
    runId: 'run',
    stepId: 'act',
    connectorId: 'crm_bharat',
    target: 'opp_101',
    idempotencyKey: 'action:key',
    status: 'executed',
    executedAt: '2026-07-22T12:00:00.000Z',
    approval: { stepId: 'review', evidence: 'approved by reviewer' },
    providerReceipt: { signature: 'signed' },
  };
  const completed: AppRunView = {
    ...RUN,
    status: 'done',
    steps: [
      {
        id: 'act',
        kind: 'action',
        label: 'Create follow-up',
        status: 'done',
        actionImpact: planActionImpact(ACTION, true),
        actionReceipt: receipt,
      },
    ],
  };
  const evidence = actionEvidenceForReview(completed, APP);
  assert.deepEqual(evidence.actionReceipt, receipt);
  assert.equal(evidence.actionImpact?.target, 'opp_101');
});
