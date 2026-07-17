import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type DispatchArgs,
  type DispatchDeps,
  dispatchAgentRun,
  PENDING_NOTE,
} from '../src/lib/agent-run-dispatch.ts';
import type { AgentRun } from '../src/lib/agentrun.ts';
import type { DurableRunHandle } from '../src/lib/adapters/agentruntime.ts';
import type { AgentRunWorkflowInput } from '../src/lib/agent-run-durable.ts';
import type { RunContext } from '../src/lib/agent-run-context.ts';

// Integration test of the durable-vs-inline SELECTION + fallback state machine (gap #12). It runs the
// REAL dispatchAgentRun orchestration with injected fakes at the two thin I/O boundaries (the durable
// submit + the in-process runAgent) — no Temporal, no DB. This proves: durable is chosen only when
// opted-in, a submitted:false handle degrades to sync, a 'pending' durable submit is reported
// honestly, and the ONE minted runId + caller context thread identically through both paths.

function fakeRun(id: string, status = 'done'): AgentRun {
  return {
    id,
    agentId: 'a1',
    query: 'q',
    answer: 'ans',
    status,
    steps: [],
    citations: [],
    checks: [],
    provenance: null,
    startedAt: new Date().toISOString(),
  };
}

// A recording deps builder: captures what submit/runAgent were called with so we can assert the
// correlation-id + context threading, and lets each test script the fakes' return values.
function makeDeps(overrides: Partial<DispatchDeps> & { durable?: boolean } = {}): {
  deps: DispatchDeps;
  calls: {
    bindings: { agentId: string; orgId: string }[];
    submit: AgentRunWorkflowInput[];
    runAgent: { orgId: string; context: RunContext }[];
  };
} {
  const calls = {
    bindings: [] as { agentId: string; orgId: string }[],
    submit: [] as AgentRunWorkflowInput[],
    runAgent: [] as { orgId: string; context: RunContext }[],
  };
  const deps: DispatchDeps = {
    resolveBinding: async (agentId, orgId) => {
      calls.bindings.push({ agentId, orgId });
      return overrides.resolveBinding
        ? overrides.resolveBinding(agentId, orgId)
        : { pipelineId: null, contract: null };
    },
    durableEnabled: () => overrides.durable ?? false,
    submit: async (input) => {
      calls.submit.push(input);
      return overrides.submit
        ? overrides.submit(input)
        : Promise.resolve<DurableRunHandle>({
            runId: input.runId,
            workflowId: `wf-${input.runId}`,
            mode: 'sync',
            submitted: false,
          });
    },
    getRun: overrides.getRun ?? (async (id) => fakeRun(id)),
    runAgent: async (agentId, query, caller, requireReview, orgId, context) => {
      calls.runAgent.push({ orgId, context });
      return overrides.runAgent
        ? overrides.runAgent(agentId, query, caller, requireReview, orgId, context)
        : fakeRun(context.runId);
    },
  };
  return { deps, calls };
}

const ARGS: DispatchArgs = {
  agentId: 'a1',
  query: 'q',
  caller: 'u@x',
  orgId: 'acme',
  actor: { type: 'user', id: 'u@x', label: 'U' },
  project: 'p1',
};

test('durable disabled → runs SYNC in-process, never submits', async () => {
  const { deps, calls } = makeDeps({ durable: false });
  const r = await dispatchAgentRun(ARGS, deps);
  assert.equal(r.mode, 'sync');
  assert.equal(calls.submit.length, 0);
  assert.equal(calls.runAgent.length, 1);
  assert.ok(r.run);
});

test('durable enabled + submitted:false (Temporal unreachable) → GRACEFUL sync fallback', async () => {
  const { deps, calls } = makeDeps({
    durable: true,
    submit: async (input) => ({
      runId: input.runId,
      workflowId: `wf-${input.runId}`,
      mode: 'sync',
      submitted: false,
    }),
  });
  const r = await dispatchAgentRun(ARGS, deps);
  assert.equal(r.mode, 'sync', 'unreachable durable must degrade to sync, not fail');
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.runAgent.length, 1, 'fell back to in-process');
});

test('durable enabled + submitted result landed → mode durable, reads persisted run', async () => {
  const { deps, calls } = makeDeps({
    durable: true,
    submit: async (input) => ({
      runId: input.runId,
      workflowId: `wf-${input.runId}`,
      mode: 'durable',
      submitted: true,
      status: 'done',
    }),
    getRun: async (id) => fakeRun(id, 'done'),
  });
  const r = await dispatchAgentRun(ARGS, deps);
  assert.equal(r.mode, 'durable');
  assert.equal(calls.runAgent.length, 0, 'durable path must NOT run in-process');
  assert.equal(r.run?.status, 'done');
  assert.ok(r.workflowId);
});

test('durable enabled + result still pending (await budget elapsed) → mode pending', async () => {
  const { deps } = makeDeps({
    durable: true,
    submit: async (input) => ({
      runId: input.runId,
      workflowId: `wf-${input.runId}`,
      mode: 'durable',
      submitted: true,
      status: 'running',
      note: PENDING_NOTE,
    }),
    // The worker hasn't persisted the row yet — read-back returns null.
    getRun: async () => null,
  });
  const r = await dispatchAgentRun(ARGS, deps);
  assert.equal(r.mode, 'pending');
  assert.equal(r.run, null, 'row not yet persisted — client polls');
  assert.ok(r.workflowId);
  assert.ok(r.runId);
});

test('durable submit reports not_found (unknown agent) → mode durable, run null (404)', async () => {
  const { deps, calls } = makeDeps({
    durable: true,
    submit: async (input) => ({
      runId: input.runId,
      workflowId: `wf-${input.runId}`,
      mode: 'durable',
      submitted: true,
      status: 'not_found',
    }),
  });
  const r = await dispatchAgentRun(ARGS, deps);
  assert.equal(r.mode, 'durable');
  assert.equal(r.run, null);
  assert.equal(calls.runAgent.length, 0, 'must not fall back to sync for a known not_found');
});

test('ONE runId is minted and threaded identically to the durable submit AND the sync context', async () => {
  // durable submit path — capture the runId handed to the workflow input.
  const durable = makeDeps({
    durable: true,
    submit: async (input) => ({
      runId: input.runId,
      workflowId: `wf-${input.runId}`,
      mode: 'durable',
      submitted: true,
      status: 'done',
    }),
  });
  const rd = await dispatchAgentRun(ARGS, durable.deps);
  assert.equal(durable.calls.submit[0]!.runId, rd.runId, 'workflow input carries the minted runId');
  // The workflow input carries the resolved actor + org + project (C4 attribution parity).
  assert.deepEqual(durable.calls.submit[0]!.actor, ARGS.actor);
  assert.equal(durable.calls.submit[0]!.orgId, 'acme');
  assert.equal(durable.calls.submit[0]!.project, 'p1');

  // sync fallback path — capture the runId handed to runAgent's context.
  const sync = makeDeps({ durable: false });
  const rs = await dispatchAgentRun(ARGS, sync.deps);
  assert.equal(
    sync.calls.runAgent[0]!.context.runId,
    rs.runId,
    'sync context reuses the minted runId',
  );
  assert.equal(sync.calls.runAgent[0]!.context.org, 'acme');
  assert.deepEqual(sync.calls.runAgent[0]!.context.actor, ARGS.actor);
  assert.equal(sync.calls.runAgent[0]!.context.project, 'p1');
});

test('dispatch resolves the explicit agent binding once and threads it to sync + durable paths', async () => {
  const resolveBinding: DispatchDeps['resolveBinding'] = async (agentId, orgId) => {
    assert.equal(agentId, 'a1');
    assert.equal(orgId, 'acme');
    return { pipelineId: 'pl_agent', contract: null };
  };

  const sync = makeDeps({ durable: false, resolveBinding });
  await dispatchAgentRun(ARGS, sync.deps);
  assert.deepEqual(sync.calls.bindings, [{ agentId: 'a1', orgId: 'acme' }]);
  assert.equal(sync.calls.runAgent[0]?.context.pipelineId, 'pl_agent');

  const durable = makeDeps({
    durable: true,
    resolveBinding,
    submit: async (input) => ({
      runId: input.runId,
      workflowId: `wf-${input.runId}`,
      mode: 'durable',
      submitted: true,
      status: 'done',
    }),
  });
  await dispatchAgentRun(ARGS, durable.deps);
  assert.equal(durable.calls.submit[0]?.pipelineId, 'pl_agent');
});

test('getRun rejection on the pending path is swallowed → still reports pending (never throws)', async () => {
  const { deps } = makeDeps({
    durable: true,
    submit: async (input) => ({
      runId: input.runId,
      workflowId: `wf-${input.runId}`,
      mode: 'durable',
      submitted: true,
      status: 'running',
      note: PENDING_NOTE,
    }),
    getRun: async () => {
      throw new Error('db blip');
    },
  });
  const r = await dispatchAgentRun(ARGS, deps);
  assert.equal(r.mode, 'pending');
  assert.equal(r.run, null);
});
