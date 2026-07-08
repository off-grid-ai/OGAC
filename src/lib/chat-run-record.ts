// The shared GOVERNED-CHAT-RUN record — the fan-out both the durable worker activity and the inline
// fallback run, so a chat run is recorded identically whether it rode Temporal or ran in-process
// (mirrors runAgentPipeline reusing runAgent verbatim). It:
//   • emits the source→answer LINEAGE edge (correlated by the run id) — agentrun.ts step 8a,
//   • signs the answer for PROVENANCE (agentrun.ts step 7),
//   • writes the canonical ATTRIBUTED audit event (action=chat.run, correlated by runId) so
//     Analytics/FinOps/Regulatory count the run and can prove its guardrail outcome.
//
// It duplicates NEITHER the guardrail scan (that ran on the model path, in the route/chat-run.ts)
// NOR the token stream (that is inline in the route). It records the run's trust artifacts + audit.

import { recordAudit } from '@/lib/store';
import { actorFrom, outcomeFromStatus } from '@/lib/audit-event';
import {
  type ChatProvenance,
  type ChatRunWorkflowInput,
  type ChatRunWorkflowResult,
  emitChatLineage,
  signChatAnswer,
} from '@/lib/chat-run';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';
import { outcomeFromChecks } from '@/lib/checks';

/**
 * Record a governed chat run: lineage + provenance + attributed audit. Returns the run result AND
 * the signed provenance so the caller (route) can persist it with the assistant message. Best-effort
 * throughout — a plane being down never fails the chat turn (each emit swallows its own error).
 */
export async function recordChatRunGovernance(
  input: ChatRunWorkflowInput,
): Promise<ChatRunWorkflowResult & { provenance: ChatProvenance | null }> {
  const orgId = input.orgId ?? DEFAULT_ORG;

  // Provenance — sign the answer, bound to the run id (skipped when there is no answer to sign, e.g.
  // an input-blocked run). Best-effort: a signing failure yields null, not a throw.
  const provenance =
    input.answer && input.status === 'done'
      ? signChatAnswer({
          runId: input.runId,
          conversationId: input.conversationId,
          query: input.query,
          answer: input.answer,
          refs: input.refs,
        })
      : null;

  // Lineage — the source→answer edge, correlated by the run id (fire-and-forget).
  emitChatLineage({
    runId: input.runId,
    conversationId: input.conversationId,
    refs: input.refs,
  });

  // Audit — the canonical attributed event so the chat run is counted + its guardrail outcome
  // provable. The outcome folds the guardrail verdicts (blocked/redacted/ok) with the run status.
  try {
    const guardOutcome = outcomeFromChecks(input.checks);
    const outcome =
      input.status === 'blocked'
        ? 'blocked'
        : guardOutcome === 'redacted'
          ? 'redacted'
          : outcomeFromStatus(input.status);
    recordAudit({
      actor: actorFrom({ email: input.userId }),
      org: orgId,
      project: input.project ?? undefined,
      action: 'chat.run',
      resource: input.conversationId ? `conversation:${input.conversationId}` : undefined,
      model: input.model || undefined,
      outcome,
      runId: input.runId,
    });
  } catch {
    /* audit best-effort — never fails the run */
  }

  return { found: true, runId: input.runId, status: input.status, provenance };
}
