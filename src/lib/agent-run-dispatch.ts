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
}): Promise<DispatchResult> {
  const runId = newRunId();
  const orgId = args.orgId ?? DEFAULT_ORG;
  const input: AgentRunWorkflowInput = {
    agentId: args.agentId,
    query: args.query,
    runId,
    caller: args.caller,
    requireReview: args.requireReview ?? false,
    orgId,
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

  // Synchronous in-process fallback (the default). runAgent generates its own runId; we return it.
  const run = await runAgent(args.agentId, args.query, args.caller, args.requireReview ?? false, orgId);
  return { run, mode: 'sync', runId: run?.id ?? runId };
}
