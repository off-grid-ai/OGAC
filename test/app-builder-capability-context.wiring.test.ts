import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppStepEditor, type StepEditorHandlers } from '@/components/build/AppStepEditor';
import type {
  BuilderCapabilityItem,
  BuilderCapabilitySliceView,
  BuilderCapabilityView,
} from '@/lib/builder-capability-view';
import type { AppStep } from '@/lib/app-model';
import type { BuilderSurfaceContextState } from '@/lib/builder-surface-access';

function item(
  ref: string,
  label: string,
  selectionState: BuilderCapabilityItem['selectionState'] = 'selectable',
  overrides: Partial<BuilderCapabilityItem> = {},
): BuilderCapabilityItem {
  return {
    ref,
    kind: ref.startsWith('data:') ? 'data' : 'capability',
    label,
    description: `${label} description`,
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
    explanation: `${label} is governed by the resolver.`,
    reasonCode: `reason.${ref}`,
    ...overrides,
  };
}

function slice(
  id: string,
  items: BuilderCapabilityItem[],
  status: BuilderCapabilitySliceView['status'] = 'ready',
): BuilderCapabilitySliceView {
  return {
    id,
    label: id,
    status,
    statusLabel: status === 'failed' ? 'Could not load' : 'Available',
    explanation: status === 'failed' ? `${id} could not be loaded.` : `${id} available.`,
    reasonCode: `slice.${status}`,
    items,
    counts: { selectable: 0, approvalRequired: 0, readOnly: 0 },
  };
}

function ready(slices: BuilderCapabilitySliceView[]): BuilderSurfaceContextState {
  const view: BuilderCapabilityView = {
    policyVersion: 'enterprise-context/v1',
    evaluatedAt: '2026-07-23T00:00:00.000Z',
    summary: { ready: 0, approvalRequired: 0, readOnly: 0, omitted: 0, incompleteSlices: 0 },
    slices,
    controls: [
      {
        id: 'select',
        intent: 'tool.select',
        label: 'Choose capabilities',
        state: 'enabled',
        statusLabel: 'Ready',
        explanation: 'You may choose capabilities.',
        reasonCode: 'allowed',
      },
    ],
  };
  return { status: 'ready', view };
}

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
  onSetTools() {},
};

function renderStep(step: AppStep, capabilityContext: BuilderSurfaceContextState, domains = []) {
  return renderToStaticMarkup(
    React.createElement(AppStepEditor, {
      step,
      index: 0,
      total: 1,
      names: { domains, agents: [] },
      handlers,
      capabilityContext,
    }),
  );
}

test('data picker uses only resolver choices and preserves a saved omitted domain for removal', () => {
  const html = renderStep(
    { id: 'read', kind: 'connector-query', label: 'Read customers', domain: 'retired' },
    ready([
      slice('data', [
        item('data:customers', 'Customer data'),
        item('data:draft', 'Draft data', 'read-only', { remedyHref: '/data/sources' }),
      ]),
    ]),
    [
      { id: 'retired', label: 'Retired customer data' },
      { id: 'raw-only', label: 'Raw list bypass' },
    ],
  );

  assert.match(html, /Retired customer data \(Saved, but not available\)/);
  assert.match(html, /value="customers"/);
  assert.match(html, /Draft data \(Setup needed\)/);
  assert.match(html, /Fix setup/);
  assert.doesNotMatch(html, /Raw list bypass/);
  assert.doesNotMatch(html, /<select[^>]*disabled=""[^>]*><option value="">— pick a data source/);
});

test('tool picker has no second fetch model and keeps approval usable while blocked choices stay inert', () => {
  const html = renderStep(
    {
      id: 'decide',
      kind: 'agent',
      label: 'Decide',
      inlineAgent: {
        systemPrompt: 'Make a decision.',
        grounded: true,
        tools: ['tool:retired'],
      },
    },
    ready([
      slice('capabilities', [
        item('app:advisor', 'Reusable advisor'),
        item('prim:web_search', 'Web search', 'selectable-with-approval'),
        item('tool:blocked', 'Blocked service', 'read-only', {
          remedyHref: '/solutions/tools/registry',
        }),
      ]),
    ]),
  );

  assert.match(html, /Reusable advisor/);
  assert.match(html, /Web search/);
  assert.match(html, /Needs approval/);
  assert.match(html, /Blocked service/);
  assert.match(html, /Saved option \(no longer available\)/);
  assert.match(html, /aria-label="Blocked service"[^>]*disabled=""/);
  assert.match(html, /aria-label="Saved option \(no longer available\)"[^>]*checked=""/);
  assert.doesNotMatch(html, /aria-label="Saved option \(no longer available\)"[^>]*disabled=""/);
  assert.doesNotMatch(html, /Loading tools|Couldn&#x27;t load the tool catalog/);
});
