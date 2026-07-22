import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  BuilderCapabilityItem,
  BuilderCapabilitySliceView,
  BuilderCapabilityView,
  BuilderControlId,
  BuilderControlState,
} from '@/lib/builder-capability-view';
import { buildBuilderCatalogueOptions } from '@/lib/builder-catalogue-options';

function item(
  ref: string,
  selectionState: BuilderCapabilityItem['selectionState'] = 'selectable',
  overrides: Partial<BuilderCapabilityItem> = {},
): BuilderCapabilityItem {
  return {
    ref,
    kind: ref.startsWith('data:') ? 'data' : ref.startsWith('action:') ? 'action' : 'capability',
    label: `Option ${ref}`,
    description: `Description ${ref}`,
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
    explanation: `Explanation ${ref}`,
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
    explanation: status === 'failed' ? `${id} could not be checked.` : `${id} is available.`,
    reasonCode: `slice.${status}`,
    items,
    counts: { selectable: 0, approvalRequired: 0, readOnly: 0 },
  };
}

function context(
  slices: BuilderCapabilitySliceView[],
  controls: Partial<Record<BuilderControlId, BuilderControlState>> = {},
) {
  const view: BuilderCapabilityView = {
    policyVersion: 'enterprise-context/v1',
    evaluatedAt: '2026-07-23T00:00:00.000Z',
    summary: { ready: 0, approvalRequired: 0, readOnly: 0, omitted: 0, incompleteSlices: 0 },
    slices,
    controls: Object.entries(controls).map(([id, state]) => ({
      id: id as BuilderControlId,
      intent:
        id === 'select'
          ? 'tool.select'
          : id === 'configure-action'
            ? 'action.configure'
            : 'build.edit',
      label: id,
      state,
      statusLabel: state === 'enabled' ? 'Ready' : 'Not available with your access',
      explanation: `Control ${id} is ${state}.`,
      reasonCode: `control.${state}`,
      remedyHref: '/governance/access',
    })),
  };
  return { status: 'ready' as const, view };
}

test('projects data, pipeline, tool, app, primitive and action refs without inventing policy', () => {
  const shared = context(
    [
      slice('data', [item('data:customers')]),
      slice('pipelines', [item('pipeline:regulated')]),
      slice('capabilities', [
        item('tool:collections'),
        item('prim:web_search', 'selectable-with-approval'),
        item('app:advisor'),
      ]),
      slice('actions', [item('action:crm.create-task', 'selectable-with-approval')]),
    ],
    { select: 'enabled', 'configure-action': 'enabled' },
  );

  assert.deepEqual(
    buildBuilderCatalogueOptions(shared, { sliceId: 'data' }).options.map((option) => option.ref),
    ['data:customers'],
  );
  assert.deepEqual(
    buildBuilderCatalogueOptions(shared, { sliceId: 'pipelines' }).options.map(
      (option) => option.ref,
    ),
    ['pipeline:regulated'],
  );
  assert.deepEqual(
    buildBuilderCatalogueOptions(shared, {
      sliceId: 'capabilities',
      controlId: 'select',
      refPrefixes: ['tool:', 'prim:', 'app:'],
    }).options.map((option) => [option.ref, option.selectable, option.requiresApproval]),
    [
      ['tool:collections', true, false],
      ['prim:web_search', true, true],
      ['app:advisor', true, false],
    ],
  );
  assert.deepEqual(
    buildBuilderCatalogueOptions(shared, {
      sliceId: 'actions',
      controlId: 'configure-action',
      refPrefixes: ['action:'],
    }).options.map((option) => [option.ref, option.selectable, option.requiresApproval]),
    [['action:crm.create-task', true, true]],
  );
});

test('keeps read-only choices visible with the resolver explanation and remedy', () => {
  const result = buildBuilderCatalogueOptions(
    context([
      slice('pipelines', [
        item('pipeline:draft', 'read-only', {
          explanation: 'Publish this pipeline before using it.',
          remedyHref: '/runtime/pipelines/draft',
        }),
      ]),
    ]),
    { sliceId: 'pipelines' },
  );

  assert.equal(result.selectionDisabled, true);
  assert.deepEqual(result.options[0], {
    ref: 'pipeline:draft',
    label: 'Option pipeline:draft',
    description: 'Description pipeline:draft',
    selectable: false,
    removable: false,
    selected: false,
    savedOnly: false,
    requiresApproval: false,
    statusLabel: 'Setup needed',
    explanation: 'Publish this pipeline before using it.',
    remedyHref: '/runtime/pipelines/draft',
  });
});

test('preserves every saved ref omitted by the resolver but never makes it selectable', () => {
  const result = buildBuilderCatalogueOptions(
    context([slice('capabilities', [])], { select: 'enabled' }),
    {
      sliceId: 'capabilities',
      controlId: 'select',
      selected: [{ ref: 'tool:retired', label: 'Retired screening tool' }, { ref: 'app:removed' }],
    },
  );

  assert.deepEqual(
    result.options.map((option) => [
      option.ref,
      option.label,
      option.selected,
      option.selectable,
      option.removable,
    ]),
    [
      ['tool:retired', 'Retired screening tool', true, false, true],
      ['app:removed', 'Saved option (no longer available)', true, false, true],
    ],
  );
  assert.equal(result.selectionDisabled, false, 'saved blocked choices can be removed');
});

test('loading, errors, missing and failed slices fail closed without dropping saved state', () => {
  const requests = [
    buildBuilderCatalogueOptions(
      { status: 'loading' },
      {
        sliceId: 'data',
        selected: [{ ref: 'data:saved', label: 'Saved data' }],
      },
    ),
    buildBuilderCatalogueOptions(
      { status: 'error', message: 'Options could not be loaded.' },
      {
        sliceId: 'data',
        selected: [{ ref: 'data:saved', label: 'Saved data' }],
      },
    ),
    buildBuilderCatalogueOptions(context([]), {
      sliceId: 'data',
      selected: [{ ref: 'data:saved', label: 'Saved data' }],
    }),
    buildBuilderCatalogueOptions(context([slice('data', [item('data:saved')], 'failed')]), {
      sliceId: 'data',
      selected: [{ ref: 'data:saved', label: 'Saved data' }],
    }),
  ];

  for (const result of requests) {
    assert.equal(result.selectionDisabled, true);
    assert.equal(result.options[0]?.selected, true);
    assert.equal(result.options[0]?.selectable, false);
    assert.equal(result.options[0]?.removable, false);
  }
  assert.match(requests[0].guidance, /Checking/);
  assert.match(requests[1].guidance, /could not be loaded/);
  assert.match(requests[2].guidance, /not available yet/);
  assert.match(requests[3].guidance, /could not be checked/);
});

test('non-enabled or missing controls override item readiness while partial slices preserve decisions', () => {
  const denied = buildBuilderCatalogueOptions(
    context([slice('capabilities', [item('tool:ready')])], { select: 'read-only' }),
    { sliceId: 'capabilities', controlId: 'select' },
  );
  const missing = buildBuilderCatalogueOptions(
    context([slice('capabilities', [item('tool:ready')])]),
    { sliceId: 'capabilities', controlId: 'select' },
  );
  const partial = buildBuilderCatalogueOptions(
    context(
      [slice('capabilities', [item('tool:ready'), item('tool:blocked', 'read-only')], 'partial')],
      { select: 'enabled' },
    ),
    { sliceId: 'capabilities', controlId: 'select' },
  );

  assert.equal(denied.options[0]?.selectable, false);
  assert.equal(denied.options[0]?.removable, false);
  assert.equal(denied.options[0]?.remedyHref, '/governance/access');
  assert.match(denied.options[0]?.explanation ?? '', /Control select/);
  assert.equal(missing.options[0]?.selectable, false);
  assert.deepEqual(
    partial.options.map((option) => [option.ref, option.selectable]),
    [
      ['tool:ready', true],
      ['tool:blocked', false],
    ],
  );
});

test('a selected unavailable item can be removed, while the same unselected item stays inert', () => {
  const state = context([
    slice('data', [item('data:retired', 'read-only'), item('data:other', 'read-only')]),
  ]);
  const result = buildBuilderCatalogueOptions(state, {
    sliceId: 'data',
    selected: [{ ref: 'data:retired', label: 'Retired data' }],
  });

  assert.deepEqual(
    result.options.map((option) => [option.ref, option.selectable, option.removable]),
    [
      ['data:retired', false, true],
      ['data:other', false, false],
    ],
  );
  assert.equal(result.selectionDisabled, false);
});

test('prefix filtering cannot reintroduce resources from another picker family', () => {
  const result = buildBuilderCatalogueOptions(
    context(
      [slice('capabilities', [item('tool:a'), item('prim:b'), item('app:c'), item('other:d')])],
      { select: 'enabled' },
    ),
    { sliceId: 'capabilities', controlId: 'select', refPrefixes: ['tool:', 'app:'] },
  );
  assert.deepEqual(
    result.options.map((option) => option.ref),
    ['tool:a', 'app:c'],
  );
});
