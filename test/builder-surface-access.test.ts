import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  BuilderCapabilityView,
  BuilderControlId,
  BuilderControlState,
  BuilderIntentControl,
} from '@/lib/builder-capability-view';
import {
  resolveBuilderSurfaceAccess,
  type BuilderSurfaceContextState,
} from '@/lib/builder-surface-access';

function control(
  id: BuilderControlId,
  state: BuilderControlState,
  explanation = `${id} is ${state}.`,
): BuilderIntentControl {
  const intent = {
    create: 'build.create',
    edit: 'build.edit',
    select: 'tool.select',
    'configure-data': 'data.configure',
    'configure-action': 'action.configure',
    publish: 'publish',
  } as const;
  return {
    id,
    intent: intent[id],
    label: id,
    state,
    statusLabel: state,
    explanation,
    reasonCode: `${id}.${state}`,
  };
}

function ready(controls: BuilderIntentControl[]): BuilderSurfaceContextState {
  const view: BuilderCapabilityView = {
    policyVersion: 'policy-v1',
    evaluatedAt: '2026-07-23T00:00:00.000Z',
    summary: { ready: 0, approvalRequired: 0, readOnly: 0, omitted: 0, incompleteSlices: 0 },
    slices: [],
    controls,
  };
  return { status: 'ready', view };
}

test('loading and request errors fail every write control closed with an honest message', () => {
  const loading = resolveBuilderSurfaceAccess({ status: 'loading' }, false);
  assert.deepEqual(
    [loading.canCreate, loading.canSave, loading.canConfigureData],
    [false, false, false],
  );
  assert.equal(loading.createExplanation, 'Checking whether you can create apps…');

  const error = resolveBuilderSurfaceAccess(
    { status: 'error', message: 'Available options could not be loaded.' },
    true,
  );
  assert.deepEqual([error.canCreate, error.canSave, error.canConfigureData], [false, false, false]);
  assert.equal(error.saveExplanation, 'Available options could not be loaded.');
});

test('a viewer remains read-only and sees the resolver explanations', () => {
  const access = resolveBuilderSurfaceAccess(
    ready([
      control('create', 'read-only', 'Builders can create apps.'),
      control('edit', 'read-only', 'Editors can change this app.'),
      control('configure-data', 'read-only', 'Data owners can connect data.'),
    ]),
    true,
  );
  assert.equal(access.canCreate, false);
  assert.equal(access.canSave, false);
  assert.equal(access.canConfigureData, false);
  assert.equal(access.saveExplanation, 'Editors can change this app.');
});

test('an admin with allowed controls can create, save, and configure data', () => {
  const access = resolveBuilderSurfaceAccess(
    ready([
      control('create', 'enabled'),
      control('edit', 'enabled'),
      control('configure-data', 'enabled'),
    ]),
    false,
  );
  assert.deepEqual([access.canCreate, access.canSave, access.canConfigureData], [true, true, true]);
});

test('editing uses build.edit independently from build.create', () => {
  const state = ready([
    control('create', 'read-only', 'Creation is unavailable.'),
    control('edit', 'enabled', 'Editing is allowed.'),
    control('configure-data', 'enabled'),
  ]);
  const createSurface = resolveBuilderSurfaceAccess(state, false);
  const editSurface = resolveBuilderSurfaceAccess(state, true);
  assert.equal(createSurface.canSave, false);
  assert.equal(createSurface.saveExplanation, 'Creation is unavailable.');
  assert.equal(editSurface.canSave, true);
  assert.equal(editSurface.saveExplanation, 'Editing is allowed.');
});

test('approval-required and missing controls fail closed', () => {
  const approval = resolveBuilderSurfaceAccess(
    ready([control('create', 'approval-required', 'A workspace owner must approve creation.')]),
    false,
  );
  assert.equal(approval.canCreate, false);
  assert.equal(approval.createExplanation, 'A workspace owner must approve creation.');
  assert.equal(approval.canConfigureData, false);
  assert.equal(approval.configureDataExplanation, 'You cannot set up data in this workspace.');
});

test('data configuration is independent from app creation and editing', () => {
  const access = resolveBuilderSurfaceAccess(
    ready([
      control('create', 'enabled'),
      control('edit', 'enabled'),
      control('configure-data', 'read-only', 'Ask a data owner to connect this source.'),
    ]),
    true,
  );
  assert.equal(access.canSave, true);
  assert.equal(access.canConfigureData, false);
  assert.equal(access.configureDataExplanation, 'Ask a data owner to connect this source.');
});
