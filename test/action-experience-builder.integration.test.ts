import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppStepEditor, type StepEditorHandlers } from '@/components/build/AppStepEditor';
import type { ActionStep } from '@/lib/app-model';

const handlers: StepEditorHandlers = {
  onRelabel() {},
  onMoveUp() {},
  onMoveDown() {},
  onRemove() {},
  onRebindDomain() {},
  onRebindAgent() {},
  onSetPrompt() {},
  onToggleGrounding() {},
  onSetSink() {},
  onConfigureAction() {},
};

const step: ActionStep = {
  id: 'act-1',
  label: 'Create the customer follow-up',
  kind: 'action',
  actionId: 'crm.create-task',
  connectorId: 'crm-main',
  approvalStepId: 'review-1',
  command: {
    operation: 'create-task',
    opportunityId: 'opp-42',
    subject: 'Call the customer about the approved offer',
    useCase: 'bank-cross-sell',
    kind: 'call',
  },
};

test('guided action editor uses outcome language and shows the complete impact before execution', () => {
  const html = renderToStaticMarkup(
    createElement(AppStepEditor, {
      step,
      index: 2,
      total: 4,
      names: {},
      handlers,
      connectors: [
        {
          id: 'crm-main',
          name: 'Customer CRM',
          type: 'crm',
          endpoint: 'http://crm:8080',
        },
      ],
      approvalSteps: [{ id: 'review-1', label: 'Branch manager review' }],
    }),
  );

  assert.match(html, /What should happen/);
  assert.match(html, /Create CRM follow-up task/);
  assert.match(html, /Which CRM connection/);
  assert.match(html, /Customer CRM/);
  assert.match(html, /Who checks it before it runs/);
  assert.match(html, /Branch manager review/);
  assert.match(html, /Follow-up title/);
  assert.match(html, /Customer opportunity/);
  assert.match(html, /No data leaves your organization/);
  assert.match(html, /A different person must approve this before it runs/);
  assert.match(html, /Signed execution receipt/);
  assert.match(html, /sm:grid-cols-2/);
  assert.doesNotMatch(html, /Kestra|Temporal|sink payload|plugin|idempotency|maker-checker/i);
});

test('guided action editor gives a direct next step when connection and approval are missing', () => {
  const html = renderToStaticMarkup(
    createElement(AppStepEditor, {
      step: {
        ...step,
        connectorId: '',
        approvalStepId: undefined,
        command: { operation: 'create-task' },
      },
      index: 0,
      total: 1,
      names: {},
      handlers,
      connectors: [
        {
          id: 'crm-cloud',
          name: 'Public cloud CRM',
          type: 'crm',
          endpoint: 'https://crm.example.com',
        },
      ],
      approvalSteps: [],
    }),
  );

  assert.match(html, /No approved internal CRM connection is available/);
  assert.match(html, /Add one under Data, then return here/);
  assert.match(html, /Add a Human review step before this action/);
  assert.match(html, /disabled=""/);
  assert.match(html, /role="status"/);
  assert.match(html, /Complete the required action details above before saving/);
  assert.doesNotMatch(html, /Public cloud CRM/);
});

test('visual editor states where action configuration is available instead of exposing dead controls', () => {
  const html = renderToStaticMarkup(
    createElement(AppStepEditor, {
      step,
      index: 2,
      total: 4,
      names: {},
      handlers: { ...handlers, onConfigureAction: undefined },
      connectors: [{ id: 'crm-main', name: 'Customer CRM', type: 'crm' }],
      approvalSteps: [{ id: 'review-1', label: 'Branch manager review' }],
    }),
  );

  assert.match(html, /Switch to Guided view to configure this action/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Follow-up title/);
  assert.match(html, /Select an approved internal connection to verify the boundary/);
});
