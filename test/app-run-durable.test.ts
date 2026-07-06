import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import {
  APP_TASK_QUEUE,
  DEFAULT_TEMPORAL_ADDRESS,
  allStepsComplete,
  appDurableConfigFromEnv,
  appWorkflowIdFor,
  hasHumanStep,
  isMultiStep,
  isPausedAppStatus,
  isTerminalAppStatus,
  shouldRunDurably,
} from '@/lib/app-run-durable';
import {
  applyStepResult,
  completedStepIds,
  initState,
  nextRunnableSteps,
} from '@/lib/app-run-plan';

// Pure-logic unit tests for the DURABLE app-run decisions + the mid-workflow HITL pause/resume the
// Phase 2B workflow drives. No Temporal, no DB, no mocks — this exercises the exact pure functions
// the deterministic workflow calls (nextRunnableSteps / applyStepResult / completedStepIds) plus the
// routing/id/config decisions the submitter adapter makes.

function spec(steps: AppSpec['steps'], edges: AppSpec['edges'] = []): AppSpec {
  return {
    id: 'app1', orgId: 'default', ownerId: 'u1', title: 'T', summary: '', visibility: 'private',
    published: false, trigger: { kind: 'on-demand' }, steps, edges,
  };
}

// ─── durability routing decision ──────────────────────────────────────────────────────────────
test('shouldRunDurably: single agent step → inline; multi-step or human → durable', () => {
  const simple = spec([{ id: 'a', label: 'A', kind: 'agent', agentId: 'ag1' }]);
  assert.equal(isMultiStep(simple), false);
  assert.equal(hasHumanStep(simple), false);
  assert.equal(shouldRunDurably(simple), false);

  const multi = spec(
    [
      { id: 'a', label: 'A', kind: 'agent', agentId: 'ag1' },
      { id: 'b', label: 'B', kind: 'output', sink: 'console' },
    ],
    [{ from: 'a', to: 'b' }],
  );
  assert.equal(isMultiStep(multi), true);
  assert.equal(shouldRunDurably(multi), true);

  // A single step that is a HUMAN step also needs durability (it PAUSES).
  const human = spec([{ id: 'h', label: 'Approve', kind: 'human' }]);
  assert.equal(isMultiStep(human), false);
  assert.equal(hasHumanStep(human), true);
  assert.equal(shouldRunDurably(human), true);
});

// ─── config + workflow id ──────────────────────────────────────────────────────────────────────
test('appDurableConfigFromEnv: fleet defaults + overrides', () => {
  const d = appDurableConfigFromEnv({});
  assert.equal(d.temporalAddress, DEFAULT_TEMPORAL_ADDRESS);
  assert.equal(d.taskQueue, APP_TASK_QUEUE);
  assert.equal(d.namespace, 'default');
  assert.equal(d.maxAttempts, 3);

  const o = appDurableConfigFromEnv({ OFFGRID_APP_TASK_QUEUE: 'q2', OFFGRID_APP_MAX_ATTEMPTS: '7' });
  assert.equal(o.taskQueue, 'q2');
  assert.equal(o.maxAttempts, 7);
  // Non-positive falls back to default (never disables retries).
  assert.equal(appDurableConfigFromEnv({ OFFGRID_APP_MAX_ATTEMPTS: '0' }).maxAttempts, 3);
});

test('appWorkflowIdFor: deterministic, embeds runId, sanitizes appId', () => {
  assert.equal(appWorkflowIdFor('reimburse', 'apprun_1'), 'apprun-reimburse-apprun_1');
  assert.equal(appWorkflowIdFor('a', 'r1'), appWorkflowIdFor('a', 'r1'));
  assert.notEqual(appWorkflowIdFor('a', 'r1'), appWorkflowIdFor('a', 'r2'));
  assert.match(appWorkflowIdFor('app/with space:x', 'r1'), /^apprun-app_with_space_x-r1$/);
  // Empty appId still yields a safe id.
  assert.match(appWorkflowIdFor('', 'r1'), /^apprun-app-r1$/);
});

test('isTerminalAppStatus / isPausedAppStatus: awaiting_human is non-terminal + paused', () => {
  assert.equal(isPausedAppStatus('awaiting_human'), true);
  assert.equal(isTerminalAppStatus('awaiting_human'), false);
  for (const s of ['done', 'error', 'cancelled']) assert.equal(isTerminalAppStatus(s), true);
  for (const s of ['queued', 'running', 'awaiting_human']) assert.equal(isTerminalAppStatus(s), false);
});

// ─── THE MID-WORKFLOW HITL PAUSE/RESUME (risk #1) — via the exact pure fns the workflow drives ───
// This simulates the durable workflow's step loop over a spec with a human step, WITHOUT Temporal:
// it uses nextRunnableSteps + applyStepResult + completedStepIds exactly as AppRunWorkflow does, and
// asserts that (a) the run PAUSES at the human step (awaiting_human, downstream NOT advanced), and
// (b) after a resume decision folds the step to 'done', the downstream step becomes runnable and the
// run completes. (c) a reject folds to 'error' and halts.
const HITL = spec(
  [
    { id: 's1', label: 'draft', kind: 'agent', agentId: 'ag1' },
    { id: 'h', label: 'approve draft', kind: 'human' },
    { id: 's3', label: 'send', kind: 'output', sink: 'console' },
  ],
  [{ from: 's1', to: 'h' }, { from: 'h', to: 's3' }],
);

test('HITL: run pauses at the human step and does NOT advance downstream until resumed', () => {
  let state = initState(HITL, 'run_hitl');
  // s1 runs and completes.
  assert.deepEqual(nextRunnableSteps(HITL, completedStepIds(state)).map((s) => s.id), ['s1']);
  state = applyStepResult(state, 's1', { status: 'done', output: 'the draft' });

  // Human step is now runnable; executing it yields awaiting_human (the workflow blocks here).
  assert.deepEqual(nextRunnableSteps(HITL, completedStepIds(state)).map((s) => s.id), ['h']);
  state = applyStepResult(state, 'h', { status: 'awaiting_human', detail: 'awaiting decision' });

  // Run rolls up to awaiting_human. The human step has NOT completed (awaiting_human ≠ done), so
  // downstream 's3' is NOT runnable — the run is paused. The workflow blocks on the condition() here
  // rather than re-executing 'h', so what matters is that 's3' cannot advance.
  assert.equal(state.status, 'awaiting_human');
  assert.deepEqual(completedStepIds(state), ['s1']);
  assert.equal(nextRunnableSteps(HITL, completedStepIds(state)).some((s) => s.id === 's3'), false);
});

test('HITL: an APPROVE resume folds the human step to done → downstream advances → run completes', () => {
  let state = initState(HITL, 'run_hitl');
  state = applyStepResult(state, 's1', { status: 'done', output: 'the draft' });
  state = applyStepResult(state, 'h', { status: 'awaiting_human' });
  assert.equal(state.status, 'awaiting_human');

  // Resume: approve with an edited output (the workflow's resolveHumanStep produces status:'done').
  state = applyStepResult(state, 'h', { status: 'done', output: 'the approved draft' });
  assert.deepEqual(completedStepIds(state), ['s1', 'h']);
  // Now the output step is runnable.
  assert.deepEqual(nextRunnableSteps(HITL, completedStepIds(state)).map((s) => s.id), ['s3']);
  state = applyStepResult(state, 's3', { status: 'done', output: 'sent' });
  assert.equal(state.status, 'done');
  assert.equal(allStepsComplete(HITL, completedStepIds(state)), true);
});

test('HITL: a REJECT resume folds the human step to error → run halts', () => {
  let state = initState(HITL, 'run_hitl');
  state = applyStepResult(state, 's1', { status: 'done', output: 'the draft' });
  state = applyStepResult(state, 'h', { status: 'awaiting_human' });
  // Reject → error.
  state = applyStepResult(state, 'h', { status: 'error', detail: 'human rejected' });
  assert.equal(state.status, 'error');
  // The run is halted (status 'error'); the workflow breaks out here and never advances. The
  // downstream output step 's3' is NOT reachable — its predecessor 'h' errored (not done/skipped),
  // so it is never in the runnable set.
  assert.equal(completedStepIds(state).includes('h'), false);
  assert.equal(nextRunnableSteps(HITL, completedStepIds(state)).some((s) => s.id === 's3'), false);
});
