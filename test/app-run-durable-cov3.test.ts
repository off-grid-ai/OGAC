import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '../src/lib/app-model.ts';
import {
  appDurableConfigFromEnv,
  hasHumanStep,
  isMultiStep,
  shouldRunDurably,
  appWorkflowIdFor,
  isTerminalAppStatus,
  isPausedAppStatus,
  allStepsComplete,
  APP_TASK_QUEUE,
  DEFAULT_TEMPORAL_ADDRESS,
} from '../src/lib/app-run-durable.ts';

// Branch top-up for app-run-durable.ts — both arms of the env fallbacks, the durability routing
// decision, the id sanitizer, and the status/completion predicates.

function spec(steps: AppSpec['steps']): AppSpec {
  return {
    id: 'a', orgId: 'default', ownerId: 'u', title: 't', summary: '', visibility: 'private',
    published: false, trigger: { kind: 'on-demand' }, steps, edges: [],
  };
}

test('appDurableConfigFromEnv: empty env → all defaults', () => {
  const c = appDurableConfigFromEnv();
  assert.equal(c.temporalAddress, DEFAULT_TEMPORAL_ADDRESS);
  assert.equal(c.namespace, 'default');
  assert.equal(c.taskQueue, APP_TASK_QUEUE);
  assert.equal(c.maxAttempts, 3);
});

test('appDurableConfigFromEnv: overrides applied, and invalid/non-positive numbers fall back', () => {
  const c = appDurableConfigFromEnv({
    OFFGRID_TEMPORAL_ADDRESS: '10.0.0.1:7233',
    OFFGRID_TEMPORAL_NAMESPACE: 'prod',
    OFFGRID_APP_TASK_QUEUE: 'q1',
    OFFGRID_APP_MAX_ATTEMPTS: '5',
  });
  assert.equal(c.temporalAddress, '10.0.0.1:7233');
  assert.equal(c.namespace, 'prod');
  assert.equal(c.taskQueue, 'q1');
  assert.equal(c.maxAttempts, 5);

  // non-numeric → default; zero/negative → default; whitespace address → default
  assert.equal(appDurableConfigFromEnv({ OFFGRID_APP_MAX_ATTEMPTS: 'abc' }).maxAttempts, 3);
  assert.equal(appDurableConfigFromEnv({ OFFGRID_APP_MAX_ATTEMPTS: '0' }).maxAttempts, 3);
  assert.equal(appDurableConfigFromEnv({ OFFGRID_APP_MAX_ATTEMPTS: '-2' }).maxAttempts, 3);
  assert.equal(appDurableConfigFromEnv({ OFFGRID_TEMPORAL_ADDRESS: '   ' }).temporalAddress, DEFAULT_TEMPORAL_ADDRESS);
});

test('hasHumanStep / isMultiStep / shouldRunDurably both arms', () => {
  const single = spec([{ id: 's1', label: 'a', kind: 'agent', agentId: 'x' }]);
  const withHuman = spec([{ id: 's1', label: 'a', kind: 'human' }]);
  const multi = spec([
    { id: 's1', label: 'a', kind: 'agent', agentId: 'x' },
    { id: 's2', label: 'b', kind: 'output', sink: 'console' },
  ]);
  assert.equal(hasHumanStep(single), false);
  assert.equal(hasHumanStep(withHuman), true);
  assert.equal(isMultiStep(single), false);
  assert.equal(isMultiStep(multi), true);
  // shouldRunDurably: single non-human = false; multi = true; single human = true
  assert.equal(shouldRunDurably(single), false);
  assert.equal(shouldRunDurably(multi), true);
  assert.equal(shouldRunDurably(withHuman), true);
});

test('hasHumanStep / isMultiStep tolerate a spec with no steps array', () => {
  const bad = { steps: undefined } as unknown as AppSpec;
  assert.equal(hasHumanStep(bad), false);
  assert.equal(isMultiStep(bad), false);
});

test('appWorkflowIdFor sanitizes the app id, truncates, and falls back to "app"', () => {
  assert.equal(appWorkflowIdFor('my app!', 'run1'), 'apprun-my_app_-run1');
  // empty id → 'app' fallback (sanitized result is empty)
  assert.equal(appWorkflowIdFor('', 'r'), 'apprun-app-r');
  // null-ish id → 'app' fallback
  assert.equal(appWorkflowIdFor(undefined as unknown as string, 'r'), 'apprun-app-r');
  // long id truncated to 64 chars
  const long = 'x'.repeat(200);
  assert.ok(appWorkflowIdFor(long, 'r').startsWith('apprun-' + 'x'.repeat(64) + '-r'));
});

test('status predicates', () => {
  for (const s of ['done', 'error', 'cancelled']) assert.equal(isTerminalAppStatus(s), true);
  for (const s of ['running', 'awaiting_human', 'queued']) assert.equal(isTerminalAppStatus(s), false);
  assert.equal(isPausedAppStatus('awaiting_human'), true);
  assert.equal(isPausedAppStatus('running'), false);
});

test('allStepsComplete: empty steps false; partial false; all done true', () => {
  const s = spec([
    { id: 'a', label: 'a', kind: 'agent', agentId: 'x' },
    { id: 'b', label: 'b', kind: 'output', sink: 'console' },
  ]);
  assert.equal(allStepsComplete(s, []), false);
  assert.equal(allStepsComplete(s, ['a']), false);
  assert.equal(allStepsComplete(s, ['a', 'b']), true);
  assert.equal(allStepsComplete({ steps: undefined } as unknown as AppSpec, []), false);
});
