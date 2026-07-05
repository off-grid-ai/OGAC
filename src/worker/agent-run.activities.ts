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
import type { AgentRunWorkflowInput, AgentRunWorkflowResult } from '../lib/agent-run-durable';

/** Run the full agent pipeline durably. Reuses runAgent; persists as the sync path does. */
export async function runAgentPipeline(
  input: AgentRunWorkflowInput,
): Promise<AgentRunWorkflowResult> {
  const run = await runAgent(
    input.agentId,
    input.query,
    input.caller,
    input.requireReview ?? false,
    input.orgId,
  );
  if (!run) return { found: false, runId: input.runId, status: 'not_found' };
  return { found: true, runId: run.id, status: run.status };
}
