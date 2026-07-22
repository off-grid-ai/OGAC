import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addStep,
  addStepNoRechain,
  blankStep,
  configureActionStep,
  describeStepBinding,
} from '@/lib/app-builder';
import type { AppSpec } from '@/lib/app-model';

function spec(): AppSpec {
  return {
    id: 'app',
    orgId: 'org_bharat',
    ownerId: 'maker',
    title: 'Cross-sell follow-up',
    summary: '',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps: [
      { id: 'decide', label: 'Find eligible offer', kind: 'agent', agentId: 'nba' },
      { id: 'rm-review', label: 'RM reviews', kind: 'human' },
    ],
    edges: [{ from: 'decide', to: 'rm-review' }],
  };
}

test('adding an action selects the nearest preceding human checker', () => {
  const added = addStep(spec(), 'action');
  const action = added.steps.at(-1);
  assert.equal(action?.kind, 'action');
  if (action?.kind !== 'action') return;
  assert.equal(action.approvalStepId, 'rm-review');
  assert.equal(action.actionId, 'crm.create-task');
  assert.deepEqual(action.command, {
    subject: '',
    useCase: '',
    kind: '',
    opportunityId: '',
  });
  assert.equal(describeStepBinding(action), 'needs a CRM connection');

  const noRechain = addStepNoRechain(spec(), 'action');
  const appended = noRechain.spec.steps.at(-1);
  assert.equal(appended?.kind === 'action' && appended.approvalStepId, 'rm-review');

  const noReview = { ...spec(), steps: spec().steps.slice(0, 1), edges: [] };
  const unapproved = addStep(noReview, 'action').steps.at(-1);
  assert.equal(unapproved?.kind === 'action' && unapproved.approvalStepId, undefined);
});

test('inserting an action never selects a later human step', () => {
  const inserted = addStep(spec(), 'action', 1);
  const action = inserted.steps[1];
  assert.equal(action.kind, 'action');
  if (action.kind === 'action') assert.equal(action.approvalStepId, undefined);
});

test('configureActionStep remains typed, plain-language and strips user replay keys', () => {
  const added = addStep(spec(), 'action');
  const action = added.steps.at(-1)!;
  const changedAction = configureActionStep(added, action.id, {
    actionId: 'crm.update-opportunity',
  });
  const reset = changedAction.steps.at(-1);
  assert.equal(reset?.kind, 'action');
  if (reset?.kind !== 'action') return;
  assert.deepEqual(reset.command, {
    opportunityId: '',
    useCase: '',
    followUp: { kind: '', summary: '' },
  });
  const configured = configureActionStep(changedAction, action.id, {
    connectorId: '  crm_bharat  ',
    approvalStepId: 'rm-review',
    command: {
      opportunityId: 'opp_101',
      idempotencyKey: 'user-must-not-own-this',
      followUp: { kind: 'call', summary: 'Contact customer' },
    },
  });
  const changed = configured.steps.at(-1);
  assert.equal(changed?.kind, 'action');
  if (changed?.kind !== 'action') return;
  assert.equal(changed.connectorId, 'crm_bharat');
  assert.equal('idempotencyKey' in changed.command, false);
  assert.equal(describeStepBinding(changed), 'updates CRM · approval required');

  const task = configureActionStep(configured, changed.id, { actionId: 'crm.update-task' });
  const taskAction = task.steps.at(-1);
  assert.deepEqual(taskAction?.kind === 'action' && taskAction.command, {
    taskId: '',
    patch: {},
  });
  const create = configureActionStep(task, changed.id, { actionId: 'crm.create-task' });
  const createAction = create.steps.at(-1);
  assert.deepEqual(createAction?.kind === 'action' && createAction.command, {
    subject: '',
    useCase: '',
    kind: '',
    opportunityId: '',
  });

  const cleared = configureActionStep(configured, changed.id, { approvalStepId: null });
  const clearedAction = cleared.steps.at(-1);
  assert.equal(clearedAction?.kind === 'action' && clearedAction.approvalStepId, undefined);
  assert.equal(
    configureActionStep(spec(), 'decide', { connectorId: 'crm' }).steps[0].kind,
    'agent',
  );
});

test('blank action has a safe incomplete shape and a nontechnical label', () => {
  const action = blankStep('action', 'a1');
  assert.deepEqual(action, {
    id: 'a1',
    label: 'Complete the next action',
    kind: 'action',
    actionId: 'crm.create-task',
    connectorId: '',
    command: { subject: '', useCase: '', kind: '', opportunityId: '' },
  });
});
