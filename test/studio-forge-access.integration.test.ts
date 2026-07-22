import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ForgeComposer,
  ForgeExamplePrompts,
  ForgeSaveControl,
} from '@/components/studio/StudioForge';
import type { BuilderCapabilityView, BuilderControlState } from '@/lib/builder-capability-view';
import {
  resolveBuilderSurfaceAccess,
  type BuilderSurfaceContextState,
} from '@/lib/builder-surface-access';

function ready(state: BuilderControlState, explanation: string): BuilderSurfaceContextState {
  const view: BuilderCapabilityView = {
    policyVersion: 'test',
    evaluatedAt: '2026-07-23T00:00:00.000Z',
    summary: { ready: 0, approvalRequired: 0, readOnly: 0, omitted: 0, incompleteSlices: 0 },
    slices: [],
    controls: [
      {
        id: 'create',
        intent: 'build.create',
        label: 'Create apps',
        state,
        statusLabel: state,
        explanation,
        reasonCode: `create.${state}`,
      },
    ],
  };
  return { status: 'ready', view };
}

function renderControls(state: BuilderSurfaceContextState): string {
  const access = resolveBuilderSurfaceAccess(state, false);
  return renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(ForgeExamplePrompts, { access, onSend() {} }),
      createElement(ForgeComposer, {
        access,
        busy: false,
        input: 'Build a governed app',
        hasSpec: true,
        onInput() {},
        onSend() {},
      }),
      createElement(ForgeSaveControl, {
        access,
        hasSpec: true,
        saving: false,
        onSave() {},
      }),
    ),
  );
}

test('Forge fails every compile and save entry point closed while access is loading or unavailable', () => {
  for (const [state, explanation] of [
    [{ status: 'loading' } as const, 'Checking whether you can create apps…'],
    [
      { status: 'error', message: 'Available options could not be loaded. Try again.' } as const,
      'Available options could not be loaded. Try again.',
    ],
  ] as const) {
    const html = renderControls(state);
    assert.equal((html.match(/ disabled=""/g) ?? []).length, 6);
    assert.match(html, new RegExp(explanation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(html, /aria-describedby="forge-create-explanation"/);
    assert.match(html, /aria-label="Build app"/);
    assert.match(html, />Save and open</);
  }
});

test('Forge shows viewer and operator explanations beside disabled examples, send, and save', () => {
  for (const explanation of [
    'This account can explore the Builder but cannot make changes.',
    'Apps are currently changed through an administrator-only surface.',
  ]) {
    const html = renderControls(ready('read-only', explanation));
    assert.equal((html.match(/ disabled=""/g) ?? []).length, 6);
    assert.equal((html.match(new RegExp(explanation, 'g')) ?? []).length >= 2, true);
    assert.match(html, /disabled:cursor-not-allowed/);
  }
});

test('Forge leaves examples, send, and save enabled for an allowed admin context', () => {
  const html = renderControls(ready('enabled', 'Your current role may perform this step.'));
  assert.doesNotMatch(html, / disabled=""/);
  assert.doesNotMatch(html, /forge-create-explanation/);
  assert.match(html, /Refine it/);
  assert.match(html, />Save and open</);
});
