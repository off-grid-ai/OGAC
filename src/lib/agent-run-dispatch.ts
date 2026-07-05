// Dispatch seam: choose the durable (Temporal) path or the synchronous in-process path for an
// agent run, and always return the persisted AgentRun the route serves. This is the thin I/O
// adapter over the PURE decision logic in agent-run-durable.ts — the route stays a validator.
//
// Contract with the caller (route):
//   - Returns { run, mode } where mode is 'durable' | 'sync' | 'pending'.
//   - 'durable': the Temporal worker ran the pipeline and persisted; we read the run back.
//   - 'sync':    Temporal wasn't configured/reachable → we ran runAgent in-process (the fallback).
//   - 'pending': durable submit succeeded but the result didn't land within the await budget; the
//                run is executing in the worker and will appear once it persists (poll GET /runs).
//   - run === null with mode 'sync'/'durable' means unknown agent (404).

import { randomUUID } from 'crypto';
import type { Actor } from '@/lib/audit-event';
import type { RunContext } from '@/lib/agent-run-context';
import { getAgentRun, type AgentRun, runAgent } from '@/lib/agentrun';
import { getAgentRuntime } from '@/lib/adapters/agentruntime';
import { durableEnabled, type AgentRunWorkflowInput } from '@/lib/agent-run-durable';
import { DEFAULT_ORG } from '@/lib/tenancy-policy';

export interface DispatchResult {
  run: AgentRun | null;
  mode: 'durable' | 'sync' | 'pending';
  workflowId?: string;
  runId: string;
}

export function newRunId(): string {
  return `run_${randomUUID().slice(0, 8)}`;
}

export async function dispatchAgentRun(args: {
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
}): Promise<DispatchResult> {
  // One canonical runId minted here and carried through BOTH paths: it is the workflowId seed AND
  // (via the RunContext) the id the pipeline persists + keys all four planes by, so the dispatch,
  // the workflow, and the run's fan-out all share one correlation key.
  const runId = newRunId();
  const orgId = args.orgId ?? DEFAULT_ORG;
  const input: AgentRunWorkflowInput = {
    agentId: args.agentId,
    query: args.query,
    runId,
    caller: args.caller,
    requireReview: args.requireReview ?? false,
    orgId,
    actor: args.actor,
    project: args.project,
  };

  // Durable path — only when opted in AND the runtime accepts the submission. The adapter never
  // throws: a submitted:false handle means "couldn't reach Temporal" → we fall through to sync.
  if (durableEnabled(process.env)) {
    const handle = await getAgentRuntime().submit(input);
    if (handle.submitted) {
      if (handle.note === 'workflow started; result pending') {
        // The activity persists once it finishes; the run may not exist yet.
        const existing = await getAgentRun(handle.runId).catch(() => null);
        return { run: existing, mode: 'pending', workflowId: handle.workflowId, runId };
      }
      if (handle.status === 'not_found') {
        return { run: null, mode: 'durable', workflowId: handle.workflowId, runId };
      }
      const run = await getAgentRun(handle.runId);
      return { run, mode: 'durable', workflowId: handle.workflowId, runId };
    }
    // submitted:false → graceful fallback below.
  }

  // Synchronous in-process fallback (the default). Pass the SAME context (incl. the minted runId) so
  // the fallback attributes + correlates identically to the durable path and reuses the one runId.
  const context: RunContext = {
    runId,
    actor: args.actor,
    org: orgId,
    project: args.project,
  };
  const run = await runAgent(
    args.agentId,
    args.query,
    args.caller,
    args.requireReview ?? false,
    orgId,
    context,
  );
  return { run, mode: 'sync', runId: run?.id ?? runId };
}
