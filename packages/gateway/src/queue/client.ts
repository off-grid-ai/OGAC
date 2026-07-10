// @offgrid/gateway — queue CLIENT.
//
// The producer side: the host (console / gateway process) calls enqueueInference
// to durably QUEUE a workflow inference request, and later getResult to await
// the completion. Nothing here touches the node pool — Temporal holds the
// request until a worker slot frees, which is the durable backpressure.

import { Connection, Client } from '@temporalio/client';
import type { QueueConfig, QueuedInferenceRequest, QueueResult } from './types';
import { queueConfigFromEnv } from './worker';
// Type-only import of the workflow: safe (no sandbox code pulled into the client).
import type { inferenceWorkflow } from './workflow';

let cached: { key: string; client: Client } | null = null;

async function clientFor(cfg: QueueConfig): Promise<Client> {
  const key = `${cfg.temporalAddress}/${cfg.namespace}`;
  if (cached?.key === key) return cached.client;
  const connection = await Connection.connect({ address: cfg.temporalAddress });
  const client = new Client({ connection, namespace: cfg.namespace });
  cached = { key, client };
  return client;
}

/**
 * Durably enqueue an inference request. Returns the workflowId immediately (the
 * request is now safe in Temporal); it will be drained when a worker slot opens.
 */
export async function enqueueInference(
  req: QueuedInferenceRequest,
  config: Partial<QueueConfig> = {},
): Promise<string> {
  const cfg = queueConfigFromEnv(config);
  const client = await clientFor(cfg);
  const workflowId = `inf-${req.corrId ?? cryptoRandom()}`;

  await client.workflow.start<typeof inferenceWorkflow>('inferenceWorkflow', {
    taskQueue: cfg.taskQueue,
    workflowId,
    args: [req, cfg.maxAttempts],
  });

  return workflowId;
}

/** Await the result of a previously enqueued inference workflow. */
export async function getResult(
  workflowId: string,
  config: Partial<QueueConfig> = {},
): Promise<QueueResult> {
  const cfg = queueConfigFromEnv(config);
  const client = await clientFor(cfg);
  const handle = client.workflow.getHandle(workflowId);
  return handle.result() as Promise<QueueResult>;
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
