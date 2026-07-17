// Durable agent-run WORKFLOW.
//
// A Temporal workflow is DETERMINISTIC and runs inside a v8 sandbox: it may NOT do I/O, use fetch,
// read env, or import Node modules. It only ORCHESTRATES — here it proxies the whole agent run to
// the `runAgentPipeline` activity with a retry policy + timeouts. Durability comes for free: if the
// worker crashes mid-pipeline, Temporal reschedules the activity; if the fleet is down, the
// workflow simply sits in the queue and resumes on recovery.
//
// BUILD CAVEAT: Temporal's own worker bundles this file (Worker.create → workflowsPath), NOT tsup /
// webpack — those strip the determinism Temporal needs. So keep this file self-contained: import
// ONLY from @temporalio/workflow and type-only from the pure src/lib contract. It is deliberately
// excluded from the Next build (see next.config.mjs serverExternalPackages + worker alias).

import { proxyActivities, workflowInfo } from '@temporalio/workflow';
import { runInputForExecution } from '../lib/scheduled-run-id';
import type { AgentRunWorkflowInput, AgentRunWorkflowResult } from '../lib/agent-run-durable';
import type * as activities from './agent-run.activities';
// Type-only + relative: erased at compile, so the sandbox bundle stays clean and self-contained.

function pipeline(maxAttempts: number) {
  return proxyActivities<typeof activities>({
    // The agent pipeline can be long (retrieval + LLM + grounding); prize completion over latency.
    startToCloseTimeout: '10 minutes',
    scheduleToCloseTimeout: '1 hour',
    retry: {
      initialInterval: '2s',
      backoffCoefficient: 2,
      maximumInterval: '1m',
      maximumAttempts: maxAttempts,
    },
  }).runAgentPipeline;
}

/** The durable agent-run workflow. Awaited by the client via handle.result(). */
export async function AgentRunWorkflow(
  input: AgentRunWorkflowInput,
  maxAttempts = 3,
): Promise<AgentRunWorkflowResult> {
  const runAgentPipeline = pipeline(maxAttempts);
  return runAgentPipeline(runInputForExecution(input, workflowInfo().runId));
}
