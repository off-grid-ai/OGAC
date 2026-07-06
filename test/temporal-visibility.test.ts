import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentRunListQuery,
  buildExecutionsView,
  buildWorkflowDetail,
  canCancelWorkflow,
  canRerunWorkflow,
  normalizeWorkflowStatus,
  runIdFromWorkflowId,
  shapeExecution,
  workflowActionsFor,
} from '../src/lib/temporal-visibility.ts';

// Pure-logic tests for Temporal workflow-visibility shaping — no cluster, no mocks. Feeds
// representative raw client shapes through the normalization/derivation and asserts the JSON-safe
// rows the console consumes.

test('normalizeWorkflowStatus: coerces names, tolerates casing/separators, defaults UNSPECIFIED', () => {
  assert.equal(normalizeWorkflowStatus('RUNNING'), 'RUNNING');
  assert.equal(normalizeWorkflowStatus('completed'), 'COMPLETED');
  assert.equal(normalizeWorkflowStatus('Continued-As-New'), 'CONTINUED_AS_NEW');
  assert.equal(normalizeWorkflowStatus('Timed Out'), 'TIMED_OUT');
  assert.equal(normalizeWorkflowStatus('gibberish'), 'UNSPECIFIED');
  assert.equal(normalizeWorkflowStatus(undefined), 'UNSPECIFIED');
});

test('runIdFromWorkflowId: extracts runId from agentrun workflow ids, else undefined', () => {
  assert.equal(runIdFromWorkflowId('agentrun-support-run_abcd1234'), 'run_abcd1234');
  // Agent segment containing '-' — runId is still the last dash-delimited token.
  assert.equal(runIdFromWorkflowId('agentrun-multi-word-agent-run_x'), 'run_x');
  // Non-agent-run workflows correlate to no console run.
  assert.equal(runIdFromWorkflowId('someOtherWorkflow-123'), undefined);
  // Malformed (trailing dash) → undefined.
  assert.equal(runIdFromWorkflowId('agentrun-agent-'), undefined);
});

test('shapeExecution: maps raw info → row with mapped status + timestamps + correlated runId', () => {
  const row = shapeExecution({
    workflowId: 'agentrun-support-run_1',
    runId: 'exec-uuid-123',
    type: 'AgentRunWorkflow',
    status: 'COMPLETED',
    startTime: new Date('2026-01-01T00:00:00.000Z'),
    closeTime: '2026-01-01T00:01:00.000Z',
    historyLength: 42n,
    taskQueue: 'offgrid-agents',
  });
  assert.equal(row.workflowId, 'agentrun-support-run_1');
  assert.equal(row.executionRunId, 'exec-uuid-123');
  assert.equal(row.temporalStatus, 'COMPLETED');
  assert.equal(row.status, 'done'); // COMPLETED → done via statusFromWorkflow
  assert.equal(row.startTime, '2026-01-01T00:00:00.000Z');
  assert.equal(row.closeTime, '2026-01-01T00:01:00.000Z');
  assert.equal(row.historyLength, 42); // bigint coerced to number
  assert.equal(row.runId, 'run_1');
});

test('shapeExecution: drops invalid/missing timestamps rather than emitting NaN', () => {
  const row = shapeExecution({ workflowId: 'wf-x', status: 'RUNNING', startTime: 'not-a-date' });
  assert.equal(row.startTime, undefined);
  assert.equal(row.closeTime, undefined);
  assert.equal(row.status, 'running');
  assert.equal(row.runId, undefined);
});

test('buildExecutionsView: rolls up status counts + carries configured/reachable flags', () => {
  const view = buildExecutionsView(
    [
      { workflowId: 'agentrun-a-run_1', status: 'RUNNING' },
      { workflowId: 'agentrun-a-run_2', status: 'COMPLETED' },
      { workflowId: 'agentrun-a-run_3', status: 'FAILED' },
      { workflowId: 'agentrun-a-run_4', status: 'RUNNING' },
    ],
    { configured: true, reachable: true },
  );
  assert.equal(view.object, 'temporal_workflow_executions');
  assert.equal(view.configured, true);
  assert.equal(view.reachable, true);
  assert.equal(view.executions.length, 4);
  assert.deepEqual(view.statusCounts, { running: 2, done: 1, failed: 1 });
});

test('buildExecutionsView: empty + note when unconfigured (graceful, never throws)', () => {
  const view = buildExecutionsView([], { configured: false, reachable: false, note: 'not enabled' });
  assert.deepEqual(view.executions, []);
  assert.deepEqual(view.statusCounts, {});
  assert.equal(view.note, 'not enabled');
});

test('buildWorkflowDetail: found vs not-found', () => {
  const found = buildWorkflowDetail(
    { workflowId: 'agentrun-a-run_1', status: 'COMPLETED' },
    { found: true, runId: 'run_1', status: 'done' },
  );
  assert.equal(found.found, true);
  assert.equal(found.execution?.workflowId, 'agentrun-a-run_1');
  assert.deepEqual(found.result, { found: true, runId: 'run_1', status: 'done' });

  const missing = buildWorkflowDetail(null, undefined, { note: 'workflow not found' });
  assert.equal(missing.found, false);
  assert.equal(missing.note, 'workflow not found');
  assert.equal(missing.execution, undefined);
});

test('agentRunListQuery: scopes visibility to AgentRunWorkflow', () => {
  assert.equal(agentRunListQuery(), "WorkflowType = 'AgentRunWorkflow'");
});

// ── Job-action gating ─────────────────────────────────────────────────────────────────────────

test('canCancelWorkflow: only OPEN executions (RUNNING / CONTINUED_AS_NEW) are cancellable', () => {
  assert.equal(canCancelWorkflow('RUNNING'), true);
  assert.equal(canCancelWorkflow('CONTINUED_AS_NEW'), true);
  // Closed / terminal states can't be cancelled.
  for (const s of ['COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT', 'UNSPECIFIED'] as const) {
    assert.equal(canCancelWorkflow(s), false, `${s} should not be cancellable`);
  }
});

test('canRerunWorkflow: only CLOSED executions are rerunnable; open/unknown are not', () => {
  for (const s of ['COMPLETED', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT'] as const) {
    assert.equal(canRerunWorkflow(s), true, `${s} should be rerunnable`);
  }
  assert.equal(canRerunWorkflow('RUNNING'), false);
  assert.equal(canRerunWorkflow('CONTINUED_AS_NEW'), false);
  assert.equal(canRerunWorkflow('UNSPECIFIED'), false);
});

test('workflowActionsFor: rerun XOR cancel across the lifecycle (never both, running→cancel only)', () => {
  assert.deepEqual(workflowActionsFor('RUNNING'), { rerun: false, cancel: true });
  assert.deepEqual(workflowActionsFor('COMPLETED'), { rerun: true, cancel: false });
  assert.deepEqual(workflowActionsFor('FAILED'), { rerun: true, cancel: false });
  assert.deepEqual(workflowActionsFor('TERMINATED'), { rerun: true, cancel: false });
  // An unknown/pending state offers neither, so the UI shows no dangling action.
  assert.deepEqual(workflowActionsFor('UNSPECIFIED'), { rerun: false, cancel: false });
});
