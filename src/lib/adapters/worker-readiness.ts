// ─── ADAPTER: live Temporal task-queue readiness ────────────────────────────────────────────────
//
// The I/O half of the worker-readiness capability. It asks the deployed Temporal cluster which
// pollers are actually attached to each durable queue (DescribeTaskQueue) and hands the raw response
// to the pure shaper in ../task-queue-readiness. It NEVER throws: an unreachable cluster or a failed
// per-queue probe becomes a shaped `unreachable` verdict, so the route/UI always render a truthful
// state instead of a 500.
//
// This is deliberately a REAL poller probe, not readiness inferred from Temporal availability or an
// eventual run state — that inference was the documented gap on temporal:worker-readiness and
// app-worker:task-queue-readiness.

import { appDurableConfigFromEnv, DEFAULT_TEMPORAL_ADDRESS } from '@/lib/app-run-durable';
import { durableConfigFromEnv } from '@/lib/agent-run-durable';
import { CHAT_TASK_QUEUE } from '@/lib/chat-run';
import {
  shapeQueueReadiness,
  summarizeWorkerReadiness,
  type QueueReadiness,
  type RawPoller,
  type WorkerReadinessSummary,
} from '@/lib/task-queue-readiness';

/** Temporal `TaskQueueType.TASK_QUEUE_TYPE_WORKFLOW` — the queue side pollers attach to. */
const WORKFLOW_TASK_QUEUE_TYPE = 1;

export interface WorkerQueueDef {
  name: string;
  /** Operator-facing label for the worker that owns this queue. */
  label: string;
}

/** The three durable queues the platform accepts governed work on, resolved from env. */
export function durableQueues(env: NodeJS.ProcessEnv = process.env): WorkerQueueDef[] {
  return [
    { name: appDurableConfigFromEnv(env).taskQueue, label: 'App runs (offgrid-apps)' },
    { name: durableConfigFromEnv(env).taskQueue, label: 'Agent runs (offgrid-agents)' },
    { name: env.OFFGRID_CHAT_TASK_QUEUE?.trim() || CHAT_TASK_QUEUE, label: 'Chat runs (offgrid-chat)' },
  ];
}

/** Coerce a google.protobuf.Timestamp | Date | string into an ISO string the pure shaper accepts. */
function coerceAccessTime(value: unknown): RawPoller['lastAccessTime'] {
  if (value == null) return null;
  if (value instanceof Date || typeof value === 'string' || typeof value === 'number') return value;
  const ts = value as { seconds?: unknown; nanos?: unknown };
  if (ts.seconds != null) {
    // `seconds` may be a Long-like object with toNumber(); fall back to Number().
    const secObj = ts.seconds as { toNumber?: () => number };
    const seconds = typeof secObj.toNumber === 'function' ? secObj.toNumber() : Number(ts.seconds);
    const nanos = typeof ts.nanos === 'number' ? ts.nanos : 0;
    return new Date(seconds * 1000 + Math.floor(nanos / 1e6));
  }
  return null;
}

/**
 * Probe the deployed Temporal cluster for the live poller state of every durable queue. Never
 * throws — cluster/probe failures are shaped into `unreachable` verdicts.
 */
export async function readWorkerReadiness(
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkerReadinessSummary> {
  const address = env.OFFGRID_TEMPORAL_ADDRESS?.trim() || DEFAULT_TEMPORAL_ADDRESS;
  const namespace = env.OFFGRID_TEMPORAL_NAMESPACE?.trim() || 'default';
  const queues = durableQueues(env);

  let service: {
    describeTaskQueue: (req: unknown) => Promise<{ pollers?: readonly unknown[] | null }>;
  };
  let close: () => Promise<void> = () => Promise.resolve();
  try {
    const { Connection, Client } = await import('@temporalio/client');
    const connection = await Connection.connect({ address });
    const client = new Client({ connection, namespace });
    service = client.workflowService as unknown as typeof service;
    close = () => connection.close();
  } catch (e) {
    // Cluster unreachable → every queue is unverifiable; report it truthfully rather than throwing.
    const note = `Temporal unreachable at ${address}: ${(e as Error).message}`;
    return summarizeWorkerReadiness(
      queues.map((q) => shapeQueueReadiness(q.name, null, { configured: true, note })),
    );
  }

  const results: QueueReadiness[] = [];
  for (const q of queues) {
    try {
      const desc = await service.describeTaskQueue({
        namespace,
        taskQueue: { name: q.name },
        taskQueueType: WORKFLOW_TASK_QUEUE_TYPE,
      });
      const pollers: RawPoller[] = (desc.pollers ?? []).map((p) => {
        const poller = p as { identity?: unknown; lastAccessTime?: unknown; ratePerSecond?: unknown };
        return {
          identity: poller.identity == null ? null : String(poller.identity),
          lastAccessTime: coerceAccessTime(poller.lastAccessTime),
          ratePerSecond: typeof poller.ratePerSecond === 'number' ? poller.ratePerSecond : null,
        };
      });
      results.push(shapeQueueReadiness(q.name, { pollers }));
    } catch (e) {
      results.push(
        shapeQueueReadiness(q.name, null, {
          configured: true,
          note: `Queue "${q.name}" probe failed: ${(e as Error).message}`,
        }),
      );
    }
  }
  await close().catch(() => {});
  return summarizeWorkerReadiness(results);
}
