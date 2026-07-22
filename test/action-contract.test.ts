import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTION_DESCRIPTORS,
  actionIdempotencyKey,
  actionTarget,
  hasApprovedMakerChecker,
  isActionId,
  isApprovalAncestor,
  planActionImpact,
  validateActionEnvelope,
  type ActionStepShape,
} from '@/lib/action-contract';
import { validateAppSpec, type AppSpec } from '@/lib/app-model';

const ACTION: ActionStepShape = {
  id: 'act',
  kind: 'action',
  actionId: 'crm.create-task',
  connectorId: 'crm_bharat',
  approvalStepId: 'review',
  command: {
    operation: 'create-task',
    idempotencyKey: 'cross-sell:opp-101:v1',
    opportunityId: 'opp_101',
    subject: 'Contains customer details that the preview must not echo',
  },
};

test('the action catalogue is one bounded CRM-backed contract', () => {
  assert.deepEqual(Object.keys(ACTION_DESCRIPTORS), [
    'crm.create-task',
    'crm.update-task',
    'crm.update-opportunity',
  ]);
  assert.equal(isActionId('crm.create-task'), true);
  assert.equal(isActionId('http.request'), false);
  assert.equal(isActionId(null), false);
  assert.equal(validateActionEnvelope(ACTION).ok, true);

  const invalid = validateActionEnvelope({
    ...ACTION,
    actionId: 'http.request' as never,
    connectorId: '../crm',
    approvalStepId: '',
    command: [] as never,
  });
  assert.deepEqual(invalid.errors, [
    'action step act: unknown action',
    'action step act: needs a safe connector binding',
    'action step act: command must be an object',
  ]);
  assert.deepEqual(validateActionEnvelope({ ...ACTION, approvalStepId: undefined }).errors, [
    'action step act: needs a maker-checker approval step',
  ]);
});

test('shadow impact is bounded, plain-language and classifies on-prem egress honestly', () => {
  const impact = planActionImpact(ACTION);
  assert.equal(impact.target, 'opp_101');
  assert.equal(impact.summary, 'Create CRM follow-up task for opp_101. Nothing has been changed.');
  assert.equal(impact.summary.includes('customer details'), false);
  assert.deepEqual(impact.approval, {
    required: true,
    stepId: 'review',
    status: 'required',
  });
  assert.deepEqual(impact.egress, {
    classification: 'on-prem-enterprise',
    dataLeavesOrganisation: false,
    dlp: 'not-applicable-on-prem',
  });
  assert.deepEqual(impact.sideEffects, ['Creates one record in CRM']);
  assert.equal(planActionImpact(ACTION, true).approval.status, 'approved');
  assert.equal(planActionImpact(ACTION, true).summary.endsWith('Approval recorded.'), true);

  assert.equal(actionTarget('crm.update-task', { taskId: 'task_1' }), 'task_1');
  assert.equal(actionTarget('crm.update-opportunity', { opportunityId: 'opp_2' }), 'opp_2');
  assert.equal(actionTarget('crm.create-task', {}), 'selected CRM record');
  assert.equal(actionTarget('crm.update-task', {}), 'selected CRM task');
  assert.equal(actionTarget('crm.update-opportunity', {}), 'selected CRM opportunity');
  assert.equal(actionIdempotencyKey(ACTION.command), 'cross-sell:opp-101:v1');
  assert.equal(actionIdempotencyKey({}), '');
});

test('maker-checker evidence must be the exact approved human step', () => {
  assert.equal(
    hasApprovedMakerChecker(ACTION, [
      { stepId: 'review', kind: 'human', status: 'done', detail: 'approved by reviewer' },
    ]),
    true,
  );
  for (const evidence of [
    [],
    [{ stepId: 'other', kind: 'human', status: 'done', detail: 'approved by reviewer' }],
    [{ stepId: 'review', kind: 'agent', status: 'done', detail: 'approved by reviewer' }],
    [{ stepId: 'review', kind: 'human', status: 'error', detail: 'approved by reviewer' }],
    [{ stepId: 'review', kind: 'human', status: 'done', detail: 'rejected by reviewer' }],
  ]) {
    assert.equal(hasApprovedMakerChecker(ACTION, evidence), false);
  }
  assert.equal(hasApprovedMakerChecker({ ...ACTION, approvalStepId: undefined }, []), false);
});

test('action approval must be a human ancestor in the App graph', () => {
  const steps = [
    { id: 'read', kind: 'connector-query' },
    { id: 'review', kind: 'human' },
    { id: 'act', kind: 'action' },
  ];
  const edges = [
    { from: 'read', to: 'review' },
    { from: 'review', to: 'act' },
  ];
  assert.equal(isApprovalAncestor('act', 'review', steps, edges), true);
  assert.equal(isApprovalAncestor('read', 'review', steps, edges), false);
  assert.equal(isApprovalAncestor('act', 'read', steps, edges), false);

  const spec: AppSpec = {
    id: 'app',
    orgId: 'org',
    ownerId: 'maker',
    title: 'Cross-sell follow-up',
    summary: '',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps: [
      { id: 'review', label: 'RM approves', kind: 'human' },
      { ...ACTION, label: 'Create follow-up' },
    ],
    edges: [{ from: 'review', to: 'act' }],
  };
  assert.equal(validateAppSpec(spec).ok, true);

  const bypass = {
    ...spec,
    steps: [...spec.steps, { id: 'later', label: 'Late review', kind: 'human' as const }],
    edges: [
      { from: 'act', to: 'later' },
      { from: 'review', to: 'later' },
    ],
  };
  const verdict = validateAppSpec({
    ...bypass,
    steps: bypass.steps.map((step) =>
      step.kind === 'action' ? { ...step, approvalStepId: 'later' } : step,
    ),
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors.join(' '), /must be a preceding human step/);
});
