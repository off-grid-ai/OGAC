import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AGENT_TASK_QUEUE,
  DEFAULT_TEMPORAL_ADDRESS,
  durableConfigFromEnv,
  durableEnabled,
  isTerminalStatus,
  statusFromWorkflow,
  toWorkflowInput,
  workflowIdFor,
} from '../src/lib/agent-run-durable.ts';

// Pure-logic unit tests for the durable agent-run decisions — no Temporal, no db, no mocks. This is
// everything the durable path decides BEFORE any I/O: config resolution, opt-in, workflow-id
// derivation, input validation, and workflow→run status mapping.

test('durableEnabled: opt-in only via queue flag or temporal adapter', () => {
  assert.equal(durableEnabled({}), false);
  assert.equal(durableEnabled({ OFFGRID_QUEUE_ENABLED: '1' }), true);
  assert.equal(durableEnabled({ OFFGRID_QUEUE_ENABLED: '0' }), false);
  assert.equal(durableEnabled({ OFFGRID_ADAPTER_AGENTRUNTIME: 'temporal' }), true);
  assert.equal(durableEnabled({ OFFGRID_ADAPTER_AGENTRUNTIME: 'sync' }), false);
});

test('durableConfigFromEnv: fleet defaults when unset', () => {
  const c = durableConfigFromEnv({});
  assert.equal(c.temporalAddress, DEFAULT_TEMPORAL_ADDRESS);
  assert.equal(c.namespace, 'default');
  assert.equal(c.taskQueue, AGENT_TASK_QUEUE);
  assert.equal(c.maxAttempts, 3);
});

test('durableConfigFromEnv: overrides + guards non-positive maxAttempts', () => {
  const c = durableConfigFromEnv({
    OFFGRID_TEMPORAL_ADDRESS: 'host:7233',
    OFFGRID_TEMPORAL_NAMESPACE: 'prod',
    OFFGRID_AGENT_TASK_QUEUE: 'q',
    OFFGRID_AGENT_MAX_ATTEMPTS: '5',
  });
  assert.equal(c.temporalAddress, 'host:7233');
  assert.equal(c.namespace, 'prod');
  assert.equal(c.taskQueue, 'q');
  assert.equal(c.maxAttempts, 5);
  // Bad values fall back to the default, never 0/NaN (which would disable retries).
  assert.equal(durableConfigFromEnv({ OFFGRID_AGENT_MAX_ATTEMPTS: '0' }).maxAttempts, 3);
  assert.equal(durableConfigFromEnv({ OFFGRID_AGENT_MAX_ATTEMPTS: 'nope' }).maxAttempts, 3);
});

test('workflowIdFor: deterministic, embeds runId, sanitizes agentId', () => {
  assert.equal(workflowIdFor('support', 'run_abcd1234'), 'agentrun-support-run_abcd1234');
  // Same input → same id (idempotency key).
  assert.equal(workflowIdFor('a', 'run_1'), workflowIdFor('a', 'run_1'));
  // Distinct runs → distinct ids (no collision).
  assert.notEqual(workflowIdFor('a', 'run_1'), workflowIdFor('a', 'run_2'));
  // Unsafe chars are replaced so Temporal accepts the id.
  assert.match(workflowIdFor('agent/with space:x', 'run_1'), /^agentrun-agent_with_space_x-run_1$/);
});

test('toWorkflowInput: validates required fields, normalizes optionals', () => {
  const ok = toWorkflowInput({ agentId: 'a', query: 'q', runId: 'run_1' });
  assert.deepEqual(ok, {
    agentId: 'a',
    query: 'q',
    runId: 'run_1',
    caller: undefined,
    requireReview: false,
    orgId: undefined,
  });
  const full = toWorkflowInput({
    agentId: 'a',
    query: 'q',
    runId: 'run_1',
    caller: 'me@x.io',
    requireReview: true,
    orgId: 'org_2',
  });
  assert.equal(full.caller, 'me@x.io');
  assert.equal(full.requireReview, true);
  assert.equal(full.orgId, 'org_2');

  assert.throws(() => toWorkflowInput({ query: 'q', runId: 'r' }), /agentId required/);
  assert.throws(() => toWorkflowInput({ agentId: 'a', query: '  ', runId: 'r' }), /query required/);
  assert.throws(() => toWorkflowInput({ agentId: 'a', query: 'q' }), /runId required/);
});

test('statusFromWorkflow: maps Temporal execution status → run vocabulary', () => {
  assert.equal(statusFromWorkflow('RUNNING'), 'running');
  assert.equal(statusFromWorkflow('CONTINUED_AS_NEW'), 'running');
  assert.equal(statusFromWorkflow('COMPLETED'), 'done');
  assert.equal(statusFromWorkflow('CANCELED'), 'cancelled');
  assert.equal(statusFromWorkflow('TERMINATED'), 'cancelled');
  assert.equal(statusFromWorkflow('FAILED'), 'failed');
  assert.equal(statusFromWorkflow('TIMED_OUT'), 'failed');
  assert.equal(statusFromWorkflow('UNSPECIFIED'), 'queued');
});

test('isTerminalStatus: only queued/running/pending_review are non-terminal', () => {
  assert.equal(isTerminalStatus('queued'), false);
  assert.equal(isTerminalStatus('running'), false);
  assert.equal(isTerminalStatus('pending_review'), false);
  for (const s of ['done', 'denied', 'blocked', 'rejected', 'cancelled', 'failed']) {
    assert.equal(isTerminalStatus(s), true, `${s} should be terminal`);
  }
});
