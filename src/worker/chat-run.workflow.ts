// Durable CHAT-RUN workflow (W1).
//
// A Temporal workflow is DETERMINISTIC and runs inside a v8 sandbox: no I/O, no fetch, no env, no
// Node modules. It only ORCHESTRATES — here it proxies the governed-run RECORD to the
// `recordChatRun` activity with a retry policy + timeouts. Durability comes for free: if the worker
// crashes mid-record, Temporal reschedules the activity; if the fleet is down, the workflow sits in
// the queue and resumes on recovery, so a chat turn's governed run is replayable.
//
// WHY the record, not the model call: a chat turn STREAMS tokens to the browser, so the model call
// itself stays inline in the route (the SSE stream must keep flowing). What rides Temporal is the
// GOVERNED RUN — the guardrail verdicts, citation refs, provenance + lineage fan-out — so the run is
// durable + replayable while the UX stays a live stream. Mirrors AgentRunWorkflow's shape exactly.
//
// BUILD CAVEAT: Temporal's own worker bundles this file (Worker.create → workflowsPath), NOT tsup /
// webpack. Keep it self-contained: import ONLY from @temporalio/workflow and type-only from the pure
// src/lib contract. It is excluded from the Next build (next.config serverExternalPackages + worker
// alias) and must never be imported by a route.

import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './chat-run.activities';
import type { ChatRunWorkflowInput, ChatRunWorkflowResult } from '../lib/chat-run';

function record(maxAttempts: number) {
  return proxyActivities<typeof activities>({
    startToCloseTimeout: '2 minutes',
    scheduleToCloseTimeout: '10 minutes',
    retry: {
      initialInterval: '2s',
      backoffCoefficient: 2,
      maximumInterval: '30s',
      maximumAttempts: maxAttempts,
    },
  }).recordChatRun;
}

/** The durable chat-run workflow. Awaited by the client via handle.result(). */
export async function ChatRunWorkflow(
  input: ChatRunWorkflowInput,
  maxAttempts = 3,
): Promise<ChatRunWorkflowResult> {
  const recordChatRun = record(maxAttempts);
  return recordChatRun(input);
}
