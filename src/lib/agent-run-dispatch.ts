// Dispatch seam: choose the durable (Temporal) path or the synchronous in-process path for an
// agent run, and always return the persisted AgentRun the route serves. This is the thin I/O
// adapter over the PURE decision logic in agent-run-durable.ts — the route stays a validator.
//
// SOLID: the impure collaborators (the durable-runtime submit, the in-process runAgent, the run
// read-back, and the env-driven durable toggle) are injected as `DispatchDeps` with a real-wired
// default (defaultDispatchDeps). The ORCHESTRATION — which path, how a submitted:false handle falls
// back to sync, how a 'pending' durable submit is reported — is a function over those deps, so it is
// testable end-to-end with fakes and NO Temporal/DB (see test/agent-run-dispatch.test.ts).
//
// Contract with the caller (route):
//   - Returns { run, mode } where mode is 'durable' | 'sync' | 'pending'.
//   - 'durable': the Temporal worker ran the pipeline and persisted; we read the run back.
//   - 'sync':    Temporal wasn't configured/reachable → we ran runAgent in-process (the fallback).
//   - 'pending': durable submit succeeded but the result didn't land within the await budget; the
//                run is executing in the worker and will appear once it persists (poll GET /runs).
//   - run === null with mode 'sync'/'durable' means unknown agent (404).

import { randomUUID } from 'node:crypto';
import type { DurableRunHandle } from '@/lib/adapters/agentruntime';
import type { RunContext } from '@/lib/agent-run-context';
import { durableEnabled, type AgentRunWorkflowInput } from '@/lib/agent-run-durable';
import type { AgentRun } from '@/lib/agentrun';
import type { Actor } from '@/lib/audit-event';
import { type AgentPipelineBinding, requireRunnableAgentBinding } from '@/lib/pipeline-run-glue';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

// The heavy collaborators (runAgent → gateway/DB chain, the Temporal client adapter) are pulled in
// via DYNAMIC import inside defaultDispatchDeps so merely loading this module (e.g. under node:test)
// doesn't drag the whole Next/auth/db chain in — the orchestration + its pure decisions stay light
// and unit-testable. Type-only imports above are erased at compile.

export interface DispatchResult {
  run: AgentRun | null;
  mode: 'durable' | 'sync' | 'pending';
  workflowId?: string;
  runId: string;
}

export interface DispatchArgs {
  agentId: string;
  query: string;
  caller?: string;
  requireReview?: boolean;
  orgId?: string;
  // C4: the caller context resolved by the route from the request — the resolved actor (machine vs
  // user + label) and owning project. Threaded into BOTH paths so the run's attribution is identical
  // whether it executes durably (in the worker, which has no request) or in the sync fallback.
  actor?: Actor;
  project?: string;
}

// The impure collaborators, injected so the orchestration is testable without Temporal/DB.
export interface DispatchDeps {
  /** Resolve this agent's explicit, org-scoped pipeline binding. Null never inherits chat. */
  resolveBinding: (agentId: string, orgId: string) => Promise<AgentPipelineBinding>;
  /** True when durable dispatch is opted-in (env-driven). */
  durableEnabled: () => boolean;
  /** Submit to the durable runtime. MUST NOT throw; a submitted:false handle means "run sync". */
  submit: (input: AgentRunWorkflowInput) => Promise<DurableRunHandle>;
  /**
   * Read a persisted run back by id (durable path reads what the worker persisted). ORG-SCOPED: the
   * dispatch's own org is threaded so the read-back finds the run the worker persisted under a
   * NON-default tenant (getAgentRun is now org-scoped for tenant isolation — an unscoped read here
   * would miss a non-default org's freshly-persisted run).
   */
  getRun: (id: string, orgId: string) => Promise<AgentRun | null>;
  /** Run the governed pipeline in-process (the synchronous fallback / default path). */
  runAgent: (
    agentId: string,
    query: string,
    caller: string | undefined,
    requireReview: boolean,
    orgId: string,
    context: RunContext,
  ) => Promise<AgentRun | null>;
}

// The pending-note the durable adapter returns when a submit succeeded but the result hasn't landed
// within the await budget. Shared constant so dispatch + adapter agree exactly.
export const PENDING_NOTE = 'workflow started; result pending';

// Real-wired defaults. The runtime + pipeline are lazily imported per-call so an env change (durable
// opt-in) between requests is honored and this module stays light to load.
export function defaultDispatchDeps(): DispatchDeps {
  return {
    resolveBinding: async (agentId, orgId) => {
      const { resolveAgentRunBinding } = await import('@/lib/pipeline-run-glue');
      return resolveAgentRunBinding(agentId, orgId);
    },
    durableEnabled: () => durableEnabled(process.env),
    submit: async (input) => {
      const { getAgentRuntime } = await import('@/lib/adapters/agentruntime');
      return getAgentRuntime().submit(input);
    },
    getRun: async (id, orgId) => {
      const { getAgentRun } = await import('@/lib/agentrun');
      return getAgentRun(id, orgId);
    },
    runAgent: async (agentId, query, caller, requireReview, orgId, context) => {
      const { runAgent } = await import('@/lib/agentrun');
      return runAgent(agentId, query, caller, requireReview, orgId, context);
    },
  };
}

export function newRunId(): string {
  return `run_${randomUUID().slice(0, 8)}`;
}

export async function dispatchAgentRun(
  args: DispatchArgs,
  deps: DispatchDeps = defaultDispatchDeps(),
): Promise<DispatchResult> {
  // One canonical runId minted here and carried through BOTH paths: it is the workflowId seed AND
  // (via the RunContext) the id the pipeline persists + keys all four planes by, so the dispatch,
  // the workflow, and the run's fan-out all share one correlation key.
  const runId = newRunId();
  const orgId = args.orgId ?? DEFAULT_ORG;
  // The dispatch seam is the ONE owner for agent binding resolution. Every caller (direct run,
  // Studio, webhook/trigger, rerun, Temporal) therefore receives the same explicit agent contract;
  // routes cannot accidentally omit it or substitute chat's default.
  const binding = requireRunnableAgentBinding(await deps.resolveBinding(args.agentId, orgId));
  const input: AgentRunWorkflowInput = {
    agentId: args.agentId,
    query: args.query,
    runId,
    caller: args.caller,
    requireReview: args.requireReview ?? false,
    orgId,
    actor: args.actor,
    project: args.project,
    // PA-16a-durable — thread the bound-pipeline id onto the DURABLE path so the WORKER enforces the
    // same contract the sync path does (mirrors app-run's ctx.contract?.pipelineId ?? null). The
    // route already resolved the binding into args.pipelineId (resolveAgentBinding); the workflow
    // re-resolves the full contract via an activity (the I/O boundary). Null ⇒ no binding ⇒ legacy.
    binding,
  };

  // Durable path — only when opted in AND the runtime accepts the submission. The adapter never
  // throws: a submitted:false handle means "couldn't reach Temporal" → we fall through to sync.
  if (deps.durableEnabled()) {
    const handle = await deps.submit(input);
    if (handle.submitted) {
      if (handle.note === PENDING_NOTE) {
        // The activity persists once it finishes; the run may not exist yet.
        const existing = await deps.getRun(handle.runId, orgId).catch(() => null);
        return { run: existing, mode: 'pending', workflowId: handle.workflowId, runId };
      }
      if (handle.status === 'not_found') {
        return { run: null, mode: 'durable', workflowId: handle.workflowId, runId };
      }
      const run = await deps.getRun(handle.runId, orgId);
      return { run, mode: 'durable', workflowId: handle.workflowId, runId };
    }
    // submitted:false → graceful fallback below.
  }

  // Synchronous in-process fallback (the default). Pass the SAME context (incl. the minted runId) so
  // the fallback attributes + correlates identically to the durable path and reuses the one runId.
  // PA-16b: the resolved pipeline contract rides the context so runAgent enforces the allowlist +
  // egress leash on this (the DEFAULT / most-common) path. PA-16a-durable now ALSO closes the
  // durable worker path: the workflow input carries args.pipelineId (threaded above), and the
  // runAgentPipeline activity re-resolves + enforces the same contract — so both paths are gated.
  const context: RunContext = {
    runId,
    actor: args.actor,
    org: orgId,
    project: args.project,
    contract: binding.contract,
    pipelineId: binding.pipelineId,
  };
  const run = await deps.runAgent(
    args.agentId,
    args.query,
    args.caller,
    args.requireReview ?? false,
    orgId,
    context,
  );
  return { run, mode: 'sync', runId: run?.id ?? runId };
}
