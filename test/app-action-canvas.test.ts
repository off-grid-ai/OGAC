import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  KIND_COLOR,
  KIND_LABEL,
  describeBinding,
  graphSummary,
  isStepIncomplete,
} from '@/lib/canvas-graph';
import type { ActionStep, AppSpec } from '@/lib/app-model';

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

test('canvas gives governed actions an exhaustive nontechnical presentation', () => {
  assert.equal(KIND_LABEL.action, 'Action');
  assert.equal(KIND_COLOR.action, '#2563eb');
  assert.equal(describeBinding(ACTION), 'create follow-up · approval');
  assert.equal(isStepIncomplete(ACTION), false);
  assert.equal(isStepIncomplete({ ...ACTION, connectorId: '' }), true);
  assert.equal(isStepIncomplete({ ...ACTION, command: { subject: '' } }), true);
});

test('graph summary counts action steps in the canonical kind denominator', () => {
  const spec: AppSpec = {
    id: 'app',
    orgId: 'org',
    ownerId: 'maker',
    title: 'Follow-up',
    summary: '',
    visibility: 'private',
    published: false,
    trigger: { kind: 'on-demand' },
    steps: [{ id: 'review', label: 'RM review', kind: 'human' }, ACTION],
    edges: [{ from: 'review', to: 'act' }],
  };
  assert.deepEqual(graphSummary(spec), {
    stepCount: 2,
    edgeCount: 1,
    kinds: {
      agent: 0,
      'connector-query': 0,
      guardrail: 0,
      human: 1,
      output: 0,
      action: 1,
    },
    hasHuman: true,
    incompleteCount: 0,
  });
});
