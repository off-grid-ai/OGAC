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
import { runAgent } from '../lib/agentrun';
import type { RunContext } from '../lib/agent-run-context';
import type { AgentRunWorkflowInput, AgentRunWorkflowResult } from '../lib/agent-run-durable';

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
 */
export async function runAgentPipeline(
  input: AgentRunWorkflowInput,
): Promise<AgentRunWorkflowResult> {
  const context: RunContext = {
    runId: input.runId,
    actor: input.actor,
    org: input.orgId,
    project: input.project,
  };
  const run = await runAgent(
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
