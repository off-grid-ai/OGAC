// Dispatch seam for a DURABLE chat run (W1). Records a chat turn as a Temporal workflow so it is
// replayable + gets a workflow/run id, gated by OFFGRID_QUEUE_ENABLED (the same toggle the agent /
// app runs use). Inline fallback when the queue is disabled OR Temporal is unreachable — identical
// to the agent path: selecting Temporal NEVER breaks a chat turn.
//
// UNLIKE the agent path, a chat turn STREAMS tokens to the browser, so the model call itself stays
// in the route (the SSE stream must keep flowing). The durable workflow records the GOVERNED RUN —
// the guardrail verdicts, the citation refs, the terminal status — and its activity re-emits the
// provenance/lineage/audit fan-out durably. So: the token stream is inline; the run is durable.
//
// SOLID: the impure collaborators (the Temporal client submit, the durable toggle) are injected as
// deps with a real-wired default, so the orchestration is unit-testable with fakes and NO Temporal.

import type { ChatRunWorkflowInput, ChatRunWorkflowResult } from '@/lib/chat-run';
import { CHAT_TASK_QUEUE, chatDurableEnabled, chatWorkflowIdFor } from '@/lib/chat-run';
import { recordChatRunGovernance } from '@/lib/chat-run-record';

export interface ChatDispatchResult {
  /** 'durable' — the Temporal worker recorded the run; 'inline' — recorded in-process (fallback). */
  mode: 'durable' | 'inline';
  /** The Temporal workflow id, present when the durable submit succeeded. */
  workflowId?: string;
  runId: string;
  status: string;
}

export interface ChatDispatchDeps {
  /** True when durable dispatch is opted-in (env-driven). */
  durableEnabled: () => boolean;
  /** Submit to Temporal. MUST NOT throw; submitted:false ⇒ record inline instead. */
  submit: (
    input: ChatRunWorkflowInput,
  ) => Promise<{ submitted: boolean; workflowId: string; status?: string }>;
  /** Record the governed run in-process (the inline fallback — same fan-out the worker runs). */
  recordInline: (input: ChatRunWorkflowInput) => Promise<ChatRunWorkflowResult>;
}

// The Temporal client is bound via DYNAMIC import so @temporalio/client never enters the default
// Next bundle (mirrors adapters/agentruntime.ts). A cached client per address/namespace reuses one
// gRPC channel across submits.
let cachedClient: { key: string; client: import('@temporalio/client').Client } | null = null;

async function temporalClient(address: string, namespace: string) {
  const key = `${address}/${namespace}`;
  if (cachedClient?.key === key) return cachedClient.client;
  const { Connection, Client } = await import('@temporalio/client');
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  cachedClient = { key, client };
  return client;
}

export function defaultChatDispatchDeps(): ChatDispatchDeps {
  return {
    durableEnabled: () => chatDurableEnabled(process.env),
    submit: async (input) => {
      const address = process.env.OFFGRID_TEMPORAL_ADDRESS?.trim() || '127.0.0.1:7233';
      const namespace = process.env.OFFGRID_TEMPORAL_NAMESPACE?.trim() || 'default';
      const taskQueue = process.env.OFFGRID_CHAT_TASK_QUEUE?.trim() || CHAT_TASK_QUEUE;
      const workflowId = chatWorkflowIdFor(input.conversationId, input.runId);
      try {
        const client = await temporalClient(address, namespace);
        await client.workflow.start('ChatRunWorkflow', {
          taskQueue,
          workflowId,
          args: [input],
        });
        // Bound the await so a slow/down worker never blocks the SSE response — the run is durable
        // in the queue regardless; we return the workflow id and let the record land when it drains.
        const handle = client.workflow.getHandle(workflowId);
        const budgetMs = Number(process.env.OFFGRID_CHAT_AWAIT_MS ?? '5000');
        const result = await Promise.race([
          handle.result() as Promise<ChatRunWorkflowResult>,
          new Promise<null>((resolve) => {
            const t = setTimeout(() => resolve(null), Number.isFinite(budgetMs) ? budgetMs : 5000);
            (t as { unref?: () => void }).unref?.();
          }),
        ]);
        return {
          submitted: true,
          workflowId,
          status: result ? result.status : input.status,
        };
      } catch (e) {
        // Temporal unreachable/unconfigured → inline fallback. Never throws into the chat path.
        void e;
        return { submitted: false, workflowId };
      }
    },
    recordInline: async (input) => recordChatRunGovernance(input),
  };
}

/**
 * Dispatch the GOVERNED chat run for durable recording. The token stream is owned by the route; this
 * only records the run (guardrail verdicts + trust-artifact fan-out) durably when the queue is on,
 * else inline. Returns the mode + workflow/run id so the route can surface the durable identity to
 * the client (SSE `run` event) and stamp observability.
 */
export async function dispatchChatRun(
  input: ChatRunWorkflowInput,
  deps: ChatDispatchDeps = defaultChatDispatchDeps(),
): Promise<ChatDispatchResult> {
  if (deps.durableEnabled()) {
    const handle = await deps.submit(input);
    if (handle.submitted) {
      return {
        mode: 'durable',
        workflowId: handle.workflowId,
        runId: input.runId,
        status: handle.status ?? input.status,
      };
    }
    // submitted:false → graceful inline fallback below.
  }
  const result = await deps.recordInline(input);
  return { mode: 'inline', runId: result.runId, status: result.status };
}
