import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppSpec } from '@/lib/app-model';
import {
  applyStepResult,
  deriveRunStatus,
  initState,
  nextRunnableSteps,
  topoOrder,
} from '@/lib/app-run-plan';
import { type AppRunDeps, buildAgentQuery, executeStep, runApp, type StepResult } from '@/lib/app-run';

// A 3-step reimbursement-shaped spec: connector-query (quota) → agent (decide) → output.
function spec(steps: AppSpec['steps'], edges: AppSpec['edges'] = []): AppSpec {
  return {
    id: 'app1', orgId: 'default', ownerId: 'u1', title: 'T', summary: '', visibility: 'private',
    published: false, trigger: { kind: 'on-demand' }, steps, edges,
  };
}

const LINEAR = spec(
  [
    { id: 's1', label: 'check quota', kind: 'connector-query', domain: 'reimbursement quota' },
    { id: 's2', label: 'decide eligibility', kind: 'agent', agentId: 'ag1' },
    { id: 's3', label: 'Output', kind: 'output', sink: 'console' },
  ],
  [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
);

// Fakes for the two external boundaries + a no-op persist. No live DB/gateway.
function fakeDeps(over: Partial<AppRunDeps> = {}): AppRunDeps {
  return {
    async runAgent(agentId, query) {
      return { id: `run_${agentId}`, answer: `decided from: ${query}`, status: 'done', citations: [] };
    },
    async listDomains() {
      return [{ id: 'd_hr', label: 'reimbursement quota', connectorId: 'con_hr', resource: 'employee_quota' }];
    },
    async getConnector(id) {
      return { id, type: 'mysql', endpoint: 'mysql://x' };
    },
    async queryDomain() {
      return { result: { rows: [{ used: 3, cap: 5 }], count: 1, dialect: 'mysql' }, detail: 'read 1 row' };
    },
    async runGuardrail() {
      return { blocked: false, detail: 'ok' };
    },
    async persist() {},
    ...over,
  };
}

test('topoOrder returns steps in edge order for a linear graph', () => {
  assert.deepEqual(topoOrder(LINEAR).map((s) => s.id), ['s1', 's2', 's3']);
});

test('nextRunnableSteps advances only when predecessors are complete', () => {
  assert.deepEqual(nextRunnableSteps(LINEAR, []).map((s) => s.id), ['s1']);
  assert.deepEqual(nextRunnableSteps(LINEAR, ['s1']).map((s) => s.id), ['s2']);
  assert.deepEqual(nextRunnableSteps(LINEAR, ['s1', 's2']).map((s) => s.id), ['s3']);
  assert.deepEqual(nextRunnableSteps(LINEAR, ['s1', 's2', 's3']), []);
});

test('applyStepResult advances per-step status; deriveRunStatus reflects it', () => {
  let state = initState(LINEAR, 'r1');
  assert.equal(deriveRunStatus(state.steps), 'queued');
  state = applyStepResult(state, 's1', { status: 'done' });
  assert.equal(state.steps.find((s) => s.id === 's1')?.status, 'done');
  assert.equal(deriveRunStatus(state.steps), 'running');
});

test('a human step drives the run to awaiting_human (mid-workflow pause)', () => {
  let state = initState(LINEAR, 'r2');
  state = applyStepResult(state, 's1', { status: 'awaiting_human' });
  assert.equal(deriveRunStatus(state.steps), 'awaiting_human');
});

test('buildAgentQuery threads prior-step output as context', () => {
  const prior: StepResult[] = [{ stepId: 's1', kind: 'connector-query', status: 'done', output: 'quota: 3/5' }];
  const q = buildAgentQuery({ id: 's2', label: 'decide', kind: 'agent', agentId: 'ag1' }, prior);
  assert.match(q, /CONTEXT FROM PRIOR STEPS/);
  assert.match(q, /quota: 3\/5/);
  assert.match(q, /TASK: decide/);
});

test('executeStep(human) returns awaiting_human WITHOUT blocking', async () => {
  const r = await executeStep(LINEAR, LINEAR.steps[0], [], { orgId: 'default', runId: 'r3' }, fakeDeps());
  // s0 is connector-query here; check a real human step:
  const hr = await executeStep(
    spec([{ id: 'h', label: 'review', kind: 'human' }]),
    { id: 'h', label: 'review', kind: 'human' },
    [],
    { orgId: 'default', runId: 'r3' },
    fakeDeps(),
  );
  assert.equal(hr.status, 'awaiting_human');
  assert.equal(r.status, 'done'); // connector-query succeeded via fake
});

test('runApp executes a 3-step spec in order to completion (connector→agent→output)', async () => {
  const out = await runApp(LINEAR, {}, { orgId: 'default', runId: 'r4' }, fakeDeps());
  assert.equal(out.status, 'done');
  assert.deepEqual(out.steps.map((s) => s.stepId), ['s1', 's2', 's3']);
  // the agent step saw the connector output threaded in
  assert.match(out.steps[1].output ?? '', /decided from:/);
});

test('runApp stops at awaiting_human when a human step is hit', async () => {
  const withHuman = spec(
    [
      { id: 's1', label: 'decide', kind: 'agent', agentId: 'ag1' },
      { id: 's2', label: 'review', kind: 'human' },
      { id: 's3', label: 'Output', kind: 'output', sink: 'console' },
    ],
    [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
  );
  const out = await runApp(withHuman, {}, { orgId: 'default', runId: 'r5' }, fakeDeps());
  assert.equal(out.status, 'awaiting_human');
  // the output step must NOT have run yet
  assert.equal(out.steps.find((s) => s.stepId === 's3'), undefined);
});
