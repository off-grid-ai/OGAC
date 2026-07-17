// Durable agent-run ACTIVITIES.
//
// An activity is the ONLY place that touches I/O — it runs OUTSIDE the Temporal workflow sandbox,
// so the DB, gateway, and adapters are all fine here. This activity is a THIN wrapper that reuses
// the EXISTING pipeline (runAgent in src/lib/agentrun.ts) verbatim — the policy gate, guardrails,
// retrieval, LLM, grounding, provenance and persist steps are NOT duplicated. Durability lives in
// the workflow above it: if the worker crashes mid-run, Temporal reschedules this activity.
//
// It throws on infrastructure failure so Temporal retries per the workflow's retry policy, but a
// legitimate "unknown agent" (runAgent → null) is a normal result, not an error → found:false.

// Relative (not "@/…") imports on purpose: the worker is a standalone process launched by tsx, and
// relative specifiers work without depending on an @/-alias resolver in that runtime.
//
// runAgent is pulled in via a lazy dynamic import inside defaultDeps (NOT a top-level import) so
// merely LOADING this module — e.g. under node:test to unit-test the enforcement wiring — doesn't
// drag the whole gateway/DB/next-auth chain in. The pure decisions + the dep-injected orchestration
// stay light and testable; the real runAgent is resolved only when Temporal actually invokes it.
import type { RunContext } from '../lib/agent-run-context';
import type { AgentRunWorkflowInput, AgentRunWorkflowResult } from '../lib/agent-run-durable';
import type { AgentRun } from '../lib/agentrun';
import type { AgentPipelineBinding } from '../lib/pipeline-run-glue';
import { requireRunnableAgentBinding } from '../lib/pipeline-run-glue';

/**
 * PA-16a-durable — resolve the durable run's bound-pipeline CONTRACT (I/O), using the SAME resolver
 * the inline route/dispatch uses (resolveContract in pipeline-contract.ts: getPipeline + org
 * governance defaults + overlay normalization). Mirrors app-run.activities.resolveContractActivity.
 *
 * The pipeline enforcement for an agent run lives INSIDE runAgent (enforceDataAccess before
 * retrieval, enforceModelCall before the gateway call); it consumes ctx.contract. So the worker
 * only needs to resolve the contract once and attach it to the RunContext — runAgent then gates the
 * WORKER path identically to the sync path.
 *
 * Never throws / degrades to null: no bound pipeline (null id) or an unresolvable/deleted pipeline ⇒
 * null ⇒ legacy allow (the ADDITIVE guarantee — a durable run with no binding behaves exactly as
 * before this gate existed).
 */
export async function resolveBindingActivity(
  agentId: string,
  orgId?: string,
): Promise<AgentPipelineBinding> {
  const { resolveAgentRunBinding } = await import('../lib/pipeline-run-glue');
  return resolveAgentRunBinding(agentId, orgId ?? 'default');
}

/**
 * The two impure collaborators the pipeline activity leans on, injected so the enforcement is
 * unit-testable WITHOUT a live gateway/DB (mirrors app-run's dep-injection seam). Defaults are the
 * real subsystems, as Temporal invokes it.
 */
export interface AgentPipelineDeps {
  /** Resolve the bound-pipeline contract (I/O). Default: resolveContractActivity (real resolver). */
  resolveBinding: (agentId: string, orgId?: string) => Promise<AgentPipelineBinding>;
  /** Run the governed pipeline (I/O). Default: the real runAgent, which enforces ctx.contract. */
  runAgent: (
    agentId: string,
    query: string,
    caller: string | undefined,
    requireReview: boolean,
    orgId: string | undefined,
    context: RunContext,
  ) => Promise<AgentRun | null>;
}

function defaultDeps(): AgentPipelineDeps {
  return {
    resolveBinding: resolveBindingActivity,
    // Lazy import: keeps the gateway/DB/next-auth chain out of module load (see the note above).
    runAgent: async (agentId, query, caller, requireReview, orgId, context) => {
      const { runAgent } = await import('../lib/agentrun');
      return runAgent(agentId, query, caller, requireReview, orgId, context);
    },
  };
}

/**
 * Run the full agent pipeline durably. Reuses runAgent verbatim (no duplicated pipeline); persists
 * as the sync path does.
 *
 * C4: build the caller CONTEXT from the workflow input and pass it through so runAgent attributes
 * the audit event + emits the trace/lineage/provenance with the SAME actor/org/project/runId a
 * request would have produced inline. The context carries the dispatch's runId (so the persisted
 * run + all four planes are keyed by the id the workflow tracks) and the resolved actor/project
 * (which the worker cannot recover from a session — it has no request). runAgent falls back to
 * deriving from `caller` for any field the context omits, so a bare submission still works.
 *
 * PA-16a-durable: the bound-pipeline CONTRACT is resolved ONCE from input.pipelineId (via the I/O
 * resolver) and attached to ctx.contract + ctx.pipelineId, so runAgent's pure enforcement
 * (enforceDataAccess / enforceModelCall) gates the WORKER path with the SAME contract the sync path
 * enforces — out-of-allowlist data is DENIED, and a cloud call under a local-only leash is BLOCKED.
 * Null contract (no binding) ⇒ legacy allow (unchanged). This closes the durable governance hole.
 */
export async function runAgentPipeline(
  input: AgentRunWorkflowInput,
  deps: AgentPipelineDeps = defaultDeps(),
): Promise<AgentRunWorkflowResult> {
  // Resolve the bound-pipeline contract for this durable run (I/O). Null ⇒ no binding ⇒ legacy allow.
  const binding = requireRunnableAgentBinding(
    await deps.resolveBinding(input.agentId, input.orgId),
  );
  if (input.binding) {
    const expectedId = input.binding.pipelineId;
    if (binding.state !== input.binding.state || binding.pipelineId !== expectedId) {
      requireRunnableAgentBinding({
        state: 'invalid',
        pipelineId: expectedId,
        contract: null,
        code: 'binding_changed',
        reason: 'Agent pipeline binding changed after durable submission.',
      });
    }
  }
  const context: RunContext = {
    runId: input.runId,
    actor: input.actor,
    org: input.orgId,
    project: input.project,
    // The resolved contract + its id ride the context: runAgent enforces the contract and stamps the
    // observability trace with the pipeline tag at the SOURCE, identically to the sync/inline path.
    contract: binding.contract,
    pipelineId: binding.pipelineId,
  };
  const run = await deps.runAgent(
    input.agentId,
    input.query,
    input.caller,
    input.requireReview ?? false,
    input.orgId,
    context,
  );
  if (!run) return { found: false, runId: input.runId, status: 'not_found' };
  return { found: true, runId: run.id, status: run.status };
}
