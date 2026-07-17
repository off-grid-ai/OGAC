import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enforceModelCall, type PipelineContract } from '../src/lib/pipeline-enforcement.ts';
import { authorizeAgentDomains } from '../src/lib/agent-retrieval-policy.ts';
import { ORG_GUARDRAIL_DEFAULTS, ORG_POLICY_DEFAULTS } from '../src/lib/pipeline-governance.ts';
import type { AgentPipelineDeps } from '../src/worker/agent-run.activities.ts';
import { runAgentPipeline } from '../src/worker/agent-run.activities.ts';
import type { AgentRunWorkflowInput } from '../src/lib/agent-run-durable.ts';
import type { AgentRun } from '../src/lib/agentrun.ts';
import type { RunContext } from '../src/lib/agent-run-context.ts';

// ── PA-16a-durable DURABLE-PATH (agent) enforcement proof ─────────────────────────────────────────
//
// The P1 governance hole: the DURABLE Temporal WORKER path (runAgentPipeline) built the run context
// WITHOUT the bound-pipeline contract, so the data-allowlist ceiling + egress leash were NOT enforced
// on durable agent runs — only the SYNC/inline path (runAgent, exercised by
// pipeline-enforcement-run.integration.test.ts) was governed. Prod runs durable.
//
// This test exercises the REAL runAgentPipeline (the exact function Temporal invokes) with the two
// external boundaries injected (resolveContract + runAgent) — no Temporal, no DB, no gateway. It
// proves the WORKER now:
//   1. resolves the contract from input.pipelineId (via the injected resolver, mirroring the real
//      resolveContractActivity → resolveContract), and
//   2. THREADS it onto the RunContext handed to runAgent, so runAgent's OWN pure enforcement
//      (enforceDataAccess before retrieval, enforceModelCall before the gateway call) gates the run.
//
// To prove the contract actually gates the WORKER path — not merely that it's attached — the injected
// runAgent reproduces runAgent's exact gate ORDER against the REAL pure decisions on ctx.contract
// (actual-domain authorization then enforceModelCall). So a WORKER run whose context
// carries an out-of-allowlist contract is DENIED, and one under a local-only leash with a cloud rule
// is BLOCKED — identically to the sync path. Null contract ⇒ legacy allow (unchanged).

function fakeRun(id: string, status: string): AgentRun {
  return {
    id,
    agentId: 'ag1',
    query: 'q',
    answer: status === 'done' ? 'ans' : '',
    status,
    steps: [],
    citations: [],
    checks: [],
    provenance: null,
    startedAt: new Date().toISOString(),
  };
}

// A runAgent stand-in that gates via the SAME pure decisions the real runAgent runs, over the
// contract the WORKER attached to the context. A GROUNDED agent resolves `dom_hr` from its org before
// retrieval, so both the data ceiling and the egress leash apply.
function gatingRunAgent(): {
  fn: AgentPipelineDeps['runAgent'];
  seen: RunContext[];
} {
  const seen: RunContext[] = [];
  const fn: AgentPipelineDeps['runAgent'] = async (agentId, _q, _c, _r, _o, context) => {
    seen.push(context);
    const contract = context.contract ?? null;
    // 1. data-access ceiling (before retrieval).
    const data = authorizeAgentDomains(contract, ['dom_hr']);
    if (!data.allow) return fakeRun(context.runId ?? 'r', 'denied');
    // 2. egress leash (before the model call).
    const model = enforceModelCall(contract, 'general');
    if (!model.allow) return fakeRun(context.runId ?? 'r', 'blocked');
    return fakeRun(context.runId ?? 'r', 'done');
  };
  return { fn, seen };
}

function wfInput(runId: string, pipelineId: string | null): AgentRunWorkflowInput {
  return { agentId: 'ag1', query: 'q', runId, orgId: 'default', caller: 'tester', pipelineId };
}

function contract(over: Partial<PipelineContract> = {}): PipelineContract {
  return {
    pipelineId: 'pl_test',
    dataAllowlist: [],
    routing: {},
    orgPolicyDefaults: ORG_POLICY_DEFAULTS,
    orgGuardrailDefaults: ORG_GUARDRAIL_DEFAULTS,
    policyOverlay: {},
    guardrailOverlay: {},
    ...over,
  };
}

// An injected resolver that returns the given contract for a non-null pipelineId (mirrors the real
// resolveContractActivity: null id ⇒ null ⇒ legacy allow).
function fakeResolve(c: PipelineContract | null): AgentPipelineDeps['resolveContract'] {
  return async (pipelineId) => (pipelineId ? c : null);
}

// ── no contract ⇒ unchanged (legacy allow, no regression) ─────────────────────────────────────────

test('durable worker (agent): NO pipeline ⇒ resolver returns null ⇒ run proceeds (legacy allow)', async () => {
  const { fn, seen } = gatingRunAgent();
  const res = await runAgentPipeline(wfInput('r_none', null), {
    resolveContract: fakeResolve(null),
    runAgent: fn,
  });
  assert.equal(res.found, true);
  assert.equal(res.status, 'done');
  // The worker attached a NULL contract (no binding) — enforcement is the noPipeline legacy allow.
  assert.equal(seen[0]!.contract, null);
});

// ── the data-allowlist ceiling on the WORKER path ─────────────────────────────────────────────────

test('durable worker (agent): contract WITH resolved domain allowed ⇒ run proceeds', async () => {
  const { fn, seen } = gatingRunAgent();
  const res = await runAgentPipeline(wfInput('r_allow', 'pl_test'), {
    resolveContract: fakeResolve(contract({ dataAllowlist: ['dom_hr'] })),
    runAgent: fn,
  });
  assert.equal(res.status, 'done');
  // Prove the WORKER threaded the resolved contract onto the context runAgent received.
  assert.equal(seen[0]!.contract?.pipelineId, 'pl_test');
  assert.equal(seen[0]!.pipelineId, 'pl_test');
});

test('durable worker (agent): contract WITHOUT resolved domain ⇒ data access DENIED', async () => {
  const { fn } = gatingRunAgent();
  const res = await runAgentPipeline(wfInput('r_deny', 'pl_test'), {
    resolveContract: fakeResolve(contract({ dataAllowlist: ['dom_other'] })),
    runAgent: fn,
  });
  assert.equal(res.found, true);
  assert.equal(res.status, 'denied', 'out-of-allowlist data must be denied on the WORKER path');
});

// ── the egress leash on the WORKER path ───────────────────────────────────────────────────────────

test('durable worker (agent): egress OFF + cloud rule for the run data-class ⇒ model call BLOCKED', async () => {
  // egress disallowed + a cloud rule matching data-class 'general' → the leash blocks the model call.
  // This is the SAME leash the inline/sync path hits.
  const { fn } = gatingRunAgent();
  const res = await runAgentPipeline(wfInput('r_egress', 'pl_test'), {
    resolveContract: fakeResolve(
      contract({
        dataAllowlist: ['dom_hr'],
        routing: {
          egressAllowed: false,
          rules: [
            {
              name: 'cloud-general',
              priority: 10,
              attribute: 'data_class',
              operator: 'eq',
              value: 'general',
              action: 'cloud',
              model: 'gpt-4o',
              fallback: '',
              enabled: true,
            },
          ],
        },
      }),
    ),
    runAgent: fn,
  });
  assert.equal(res.found, true);
  assert.equal(
    res.status,
    'blocked',
    'a cloud call under a local-only leash must be blocked on the WORKER path',
  );
});

test('durable worker (agent): default (local) routing ⇒ model runs on-prem, run completes', async () => {
  const { fn } = gatingRunAgent();
  const res = await runAgentPipeline(wfInput('r_local', 'pl_test'), {
    resolveContract: fakeResolve(contract({ dataAllowlist: ['dom_hr'] })),
    runAgent: fn,
  });
  assert.equal(res.status, 'done');
});

// ── unknown agent (runAgent → null) is still a clean not_found, not an error ────────────────────────

test('durable worker (agent): unknown agent ⇒ found:false (unchanged)', async () => {
  const res = await runAgentPipeline(wfInput('r_missing', null), {
    resolveContract: fakeResolve(null),
    runAgent: async () => null,
  });
  assert.equal(res.found, false);
  assert.equal(res.status, 'not_found');
  assert.equal(res.runId, 'r_missing');
});

test('durable worker: explicit pipeline resolving null fails closed before runAgent', async () => {
  let ran = false;
  await assert.rejects(
    () =>
      runAgentPipeline(wfInput('r_deleted', 'pl_deleted'), {
        resolveContract: async () => null,
        runAgent: async () => {
          ran = true;
          return fakeRun('r_deleted', 'done');
        },
      }),
    /pipeline.*unavailable|binding.*invalid/i,
  );
  assert.equal(ran, false);
});

test('durable worker: resolver/DB failure fails closed before runAgent', async () => {
  let ran = false;
  await assert.rejects(
    () =>
      runAgentPipeline(wfInput('r_db_down', 'pl_live'), {
        resolveContract: async () => {
          throw new Error('postgres unavailable');
        },
        runAgent: async () => {
          ran = true;
          return fakeRun('r_db_down', 'done');
        },
      }),
    /postgres unavailable|binding.*unavailable/i,
  );
  assert.equal(ran, false);
});
