import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  BuilderCapabilityItem,
  BuilderCapabilityView,
  BuilderControlState,
} from '@/lib/builder-capability-view';
import { buildBuilderActionOptions } from '@/lib/builder-action-options';

function actionItem(
  actionId: string,
  selectionState: BuilderCapabilityItem['selectionState'],
  overrides: Partial<BuilderCapabilityItem> = {},
): BuilderCapabilityItem {
  return {
    ref: `action:${actionId}`,
    kind: 'action',
    label: 'Resolver label is not presentation metadata',
    selectionState,
    availabilityKind:
      selectionState === 'read-only'
        ? 'configuration-required'
        : selectionState === 'selectable-with-approval'
          ? 'approval'
          : 'ready',
    statusLabel:
      selectionState === 'read-only'
        ? 'Setup needed'
        : selectionState === 'selectable-with-approval'
          ? 'Needs approval'
          : 'Ready to add',
    explanation: 'Use the next step shown here.',
    reasonCode: 'test-reason',
    ...overrides,
  };
}

function readyContext(
  items: BuilderCapabilityItem[],
  controlState: BuilderControlState = 'enabled',
  sliceStatus: 'ready' | 'partial' | 'failed' = 'ready',
) {
  const view: BuilderCapabilityView = {
    policyVersion: 'policy-1',
    evaluatedAt: '2026-07-23T00:00:00.000Z',
    summary: {
      ready: 0,
      approvalRequired: 0,
      readOnly: 0,
      omitted: 0,
      incompleteSlices: sliceStatus === 'ready' ? 0 : 1,
    },
    slices: [
      {
        id: 'actions',
        label: 'Actions',
        status: sliceStatus,
        statusLabel: sliceStatus === 'failed' ? 'Could not load' : 'Available',
        explanation:
          sliceStatus === 'failed'
            ? 'Actions could not be checked. Try again.'
            : 'Actions are available.',
        reasonCode: `slice-${sliceStatus}`,
        items,
        counts: { selectable: 0, approvalRequired: 0, readOnly: 0 },
      },
    ],
    controls: [
      {
        id: 'configure-action',
        intent: 'action.configure',
        label: 'Set up actions',
        state: controlState,
        statusLabel: controlState === 'enabled' ? 'Ready' : 'Not available with your access',
        explanation: 'Ask a workspace owner to allow action setup.',
        reasonCode: 'action-control',
      },
    ],
  };
  return { status: 'ready' as const, view };
}

test('shows only resolver-returned supported actions and uses static metadata only for labels', () => {
  const result = buildBuilderActionOptions(
    readyContext([
      actionItem('crm.create-task', 'selectable'),
      actionItem('crm.future-action', 'selectable'),
    ]),
    'crm.create-task',
  );

  assert.deepEqual(
    result.options.map((option) => option.actionId),
    ['crm.create-task'],
  );
  assert.equal(result.options[0]?.label, 'Create CRM follow-up task');
  assert.equal(result.options[0]?.selectable, true);
  assert.equal(result.selectionDisabled, false);
});

test('keeps denied and unavailable actions visible but disabled with their remedy', () => {
  const result = buildBuilderActionOptions(
    readyContext([
      actionItem('crm.create-task', 'read-only', {
        explanation: 'Add an approved CRM connection first.',
        remedyHref: '/data/sources',
      }),
      actionItem('crm.update-task', 'read-only', {
        availabilityKind: 'policy-denied',
        explanation: 'Your role cannot add this action.',
      }),
    ]),
    'crm.create-task',
  );

  assert.equal(result.options.length, 2);
  assert.equal(
    result.options.every((option) => !option.selectable),
    true,
  );
  assert.equal(result.options[0]?.remedyHref, '/data/sources');
  assert.match(result.options[1]?.explanation ?? '', /role cannot add/);
  assert.equal(result.selectionDisabled, true);
});

test('approval-required actions remain selectable and carry human guidance', () => {
  const result = buildBuilderActionOptions(
    readyContext([
      actionItem('crm.update-opportunity', 'selectable-with-approval', {
        approvalGuidance: {
          kind: 'use-existing-step',
          heading: 'Use an existing approval step',
          guidance: 'Place a human review before this action.',
          eligibleSteps: [{ ref: 'human:review-1', label: 'Branch manager review' }],
        },
      }),
    ]),
    'crm.update-opportunity',
  );

  assert.equal(result.selectionDisabled, false);
  assert.equal(result.options[0]?.selectable, true);
  assert.equal(result.options[0]?.requiresApproval, true);
  assert.equal(
    result.options[0]?.approvalGuidance?.eligibleSteps[0]?.label,
    'Branch manager review',
  );
});

test('fails closed for loading, errors, failed slices and non-enabled configure intents', () => {
  const loading = buildBuilderActionOptions({ status: 'loading' }, 'crm.create-task');
  const error = buildBuilderActionOptions(
    { status: 'error', message: 'private diagnostic' },
    'crm.create-task',
  );
  const failed = buildBuilderActionOptions(
    readyContext([actionItem('crm.create-task', 'selectable')], 'enabled', 'failed'),
    'crm.create-task',
  );
  const denied = buildBuilderActionOptions(
    readyContext([actionItem('crm.create-task', 'selectable')], 'read-only'),
    'crm.create-task',
  );
  const controlApproval = buildBuilderActionOptions(
    readyContext([actionItem('crm.create-task', 'selectable')], 'approval-required'),
    'crm.create-task',
  );

  for (const result of [loading, error, failed, denied, controlApproval]) {
    assert.equal(result.selectionDisabled, true);
    assert.equal(result.options[0]?.selectable, false);
  }
  assert.match(error.guidance, /private diagnostic/);
  assert.match(failed.guidance, /could not be checked/);
  assert.match(denied.guidance, /workspace owner/);
  assert.match(controlApproval.options[0]?.explanation ?? '', /workspace owner/);
});

test('preserves a saved action absent from the resolver without making it selectable', () => {
  const known = buildBuilderActionOptions(
    readyContext([actionItem('crm.update-task', 'selectable')]),
    'crm.create-task',
  );
  const unknown = buildBuilderActionOptions(readyContext([]), 'crm.retired-command');

  assert.deepEqual(
    known.options.map((option) => [option.actionId, option.selectable, option.savedOnly]),
    [
      ['crm.create-task', false, true],
      ['crm.update-task', true, false],
    ],
  );
  assert.equal(unknown.options[0]?.label, 'Saved action (no longer supported)');
  assert.equal(unknown.options[0]?.selectable, false);
});

test('fails closed when the resolver omits the actions slice or configure control', () => {
  const noSlice = readyContext([]);
  noSlice.view.slices = [];
  const noControl = readyContext([actionItem('crm.create-task', 'selectable')]);
  noControl.view.controls = [];

  assert.equal(buildBuilderActionOptions(noSlice, 'crm.create-task').selectionDisabled, true);
  assert.equal(buildBuilderActionOptions(noControl, 'crm.create-task').selectionDisabled, true);
});
