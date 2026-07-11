// Durable CHAT-RUN ACTIVITIES.
//
// An activity is the ONLY place that touches I/O — it runs OUTSIDE the Temporal workflow sandbox, so
// the DB, audit ledger, lineage + signing adapters are all fine here. This activity is a THIN
// wrapper that reuses recordChatRunGovernance verbatim — the SAME fan-out the inline fallback runs,
// so a durable chat run is recorded identically to an inline one (mirrors runAgentPipeline reusing
// runAgent). Durability lives in the workflow above it: if the worker crashes mid-record, Temporal
// reschedules this activity.
//
// Relative (not "@/…") imports on purpose: the worker is a standalone process launched by tsx, and
// relative specifiers work without depending on an @/-alias resolver in that runtime (mirrors
// agent-run.activities.ts).

import type { ChatRunWorkflowInput, ChatRunWorkflowResult } from '../lib/chat-run';
import { recordChatRunGovernance } from '../lib/chat-run-record';

/** Record the governed chat run durably. Reuses recordChatRunGovernance verbatim. */
export async function recordChatRun(
  input: ChatRunWorkflowInput,
): Promise<ChatRunWorkflowResult> {
  const { found, runId, status } = await recordChatRunGovernance(input);
  return { found, runId, status };
}
