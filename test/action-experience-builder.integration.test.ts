import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppStepEditor, type StepEditorHandlers } from '@/components/build/AppStepEditor';
import type { ActionStep } from '@/lib/app-model';
import type { BuilderCapabilityView } from '@/lib/builder-capability-view';

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

const ACTION_IDS = ['crm.create-task', 'crm.update-task', 'crm.update-opportunity'] as const;

function actionContext(
  selectionState: 'selectable-with-approval' | 'read-only' = 'selectable-with-approval',
  actionIds: readonly string[] = ACTION_IDS,
  explanation = 'A different person approves this action before it runs.',
) {
  const view = {
    policyVersion: 'policy-1',
    evaluatedAt: '2026-07-23T00:00:00.000Z',
    summary: { ready: 0, approvalRequired: 3, readOnly: 0, omitted: 0, incompleteSlices: 0 },
    slices: [
      {
        id: 'actions',
        label: 'Actions',
        status: 'ready',
        statusLabel: 'Available',
        explanation: 'Actions are available.',
        reasonCode: 'actions-ready',
        counts: { selectable: 0, approvalRequired: 3, readOnly: 0 },
        items: actionIds.map((actionId) => ({
          ref: `action:${actionId}`,
          kind: 'action' as const,
          label: 'Action',
          selectionState,
          availabilityKind: selectionState === 'read-only' ? 'configuration-required' : 'approval',
          statusLabel: selectionState === 'read-only' ? 'Setup needed' : 'Needs approval',
          explanation,
          reasonCode: 'action-state',
          ...(selectionState === 'read-only' ? { remedyHref: '/data/sources' } : {}),
          ...(actionId === 'crm.create-task' && selectionState !== 'read-only'
            ? {
                approvalGuidance: {
                  kind: 'use-existing-step' as const,
                  heading: 'Use an existing approval step',
                  guidance: 'Place a human review before this action.',
                  eligibleSteps: [{ ref: 'human:review-1', label: 'Branch manager review' }],
                },
              }
            : {}),
        })),
      },
    ],
    controls: [
      {
        id: 'configure-action',
        intent: 'action.configure',
        label: 'Set up actions',
        state: 'enabled',
        statusLabel: 'Ready',
        explanation: 'You can set up governed actions.',
        reasonCode: 'action-configure-allowed',
      },
    ],
  } satisfies BuilderCapabilityView;
  return { status: 'ready' as const, view };
}

const capabilityContext = actionContext();

test('guided action editor uses outcome language and shows the complete impact before execution', () => {
  const html = renderToStaticMarkup(
    createElement(AppStepEditor, {
      step,
      index: 2,
      total: 4,
      names: {},
      handlers,
      capabilityContext,
      connectors: [
        {
          id: 'crm-main',
          name: 'Customer CRM',
          type: 'rest',
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
      capabilityContext,
      connectors: [
        {
          id: 'crm-cloud',
          name: 'Public cloud CRM',
          type: 'rest',
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
      capabilityContext,
      connectors: [
        { id: 'crm-main', name: 'Customer CRM', type: 'rest', endpoint: 'http://crm:8080' },
      ],
      approvalSteps: [{ id: 'review-1', label: 'Branch manager review' }],
    }),
  );

  assert.match(html, /Switch to Guided view to configure this action/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Follow-up title/);
  assert.match(html, /No data leaves your organization/);
});

test('action editor fails closed while context loads and keeps the saved action visible', () => {
  const html = renderToStaticMarkup(
    createElement(AppStepEditor, {
      step,
      index: 0,
      total: 1,
      names: {},
      handlers,
      capabilityContext: { status: 'loading' },
      connectors: [
        { id: 'crm-main', name: 'Customer CRM', type: 'rest', endpoint: 'http://crm:8080' },
      ],
      approvalSteps: [{ id: 'review-1', label: 'Branch manager review' }],
    }),
  );

  assert.match(html, /Checking which actions you can add/);
  assert.match(html, /Create CRM follow-up task/);
  assert.match(html, /Saved, but not available/);
  assert.match(html, /disabled=""/);
});

test('action editor explains resolver-denied choices and disables every mutation control', () => {
  const html = renderToStaticMarkup(
    createElement(AppStepEditor, {
      step,
      index: 0,
      total: 1,
      names: {},
      handlers,
      capabilityContext: actionContext(
        'read-only',
        ['crm.create-task'],
        'Add an approved CRM connection before selecting this action.',
      ),
      connectors: [],
      approvalSteps: [{ id: 'review-1', label: 'Branch manager review' }],
    }),
  );

  assert.match(html, /Not available yet/);
  assert.match(html, /Add an approved CRM connection/);
  assert.match(html, /href="\/data\/sources"/);
  assert.match(html, /Fix setup/);
  assert.match(html, /This saved action stays unchanged until you choose an available action/);
  assert.doesNotMatch(html, /Follow-up title/);
  assert.match(html, /aria-label="Which CRM connection\?" disabled=""/);
  assert.match(html, /aria-label="Who checks it before it runs\?" disabled=""/);
});
