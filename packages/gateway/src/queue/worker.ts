// @offgrid/gateway — queue WORKER (the drain).
//
// The worker polls the task queue, runs the workflow, and executes the
// `runInference` activity. Its `maxConcurrentActivityTaskExecutions` is THE
// backpressure cap: it is the maximum number of inference calls in flight
// against the pool at once. Size it to a node's real capacity. Run one worker
// per node (each pointed at its own node/gateway) to drain the queue at exactly
// the aggregate rate the fleet can absorb — the server never melts.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';
import type { QueueConfig } from './types';

// Filesystem dir of THIS module, in a way that works whether tsup emits ESM
// (import.meta.url) or CJS (__dirname). Temporal needs a real path to the
// workflow file so it can bundle it with its own (determinism-preserving) tool.
const moduleDir: string =
  typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

// The built workflow module is a sibling of the worker module (dist/queue/) but
// may appear one level down from the entry (dist/) when bundlers inline. Probe.
function resolveWorkflowsPath(base: string): string {
  const candidates = [
    join(base, 'workflow.js'),
    join(base, 'queue', 'workflow.js'),
    join(base, 'workflow.cjs'),
    join(base, 'queue', 'workflow.cjs'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

/** Fill a QueueConfig from env (used by the standalone queue-cli entrypoint). */
export function queueConfigFromEnv(o: Partial<QueueConfig> = {}): QueueConfig {
  const n = (v: string | undefined, d: number): number => (v == null ? d : Number(v));
  return {
    temporalAddress: o.temporalAddress ?? process.env.OFFGRID_TEMPORAL_ADDRESS ?? 'localhost:7233',
    namespace: o.namespace ?? process.env.OFFGRID_TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: o.taskQueue ?? process.env.OFFGRID_QUEUE_TASK_QUEUE ?? 'offgrid-inference',
    maxConcurrentPerNode: o.maxConcurrentPerNode ?? n(process.env.OFFGRID_QUEUE_MAX_CONCURRENT_PER_NODE, 2),
    maxAttempts: o.maxAttempts ?? n(process.env.OFFGRID_QUEUE_MAX_ATTEMPTS, 5),
    gatewayUrl: o.gatewayUrl ?? process.env.OFFGRID_QUEUE_GATEWAY_URL ?? process.env.OFFGRID_GATEWAY_URL ?? 'http://localhost:8800',
  };
}

/**
 * Start the queue worker. Registers the workflow + activities on the task queue
 * with the backpressure concurrency cap. Returns the running Worker (call
 * worker.shutdown() to stop). The activity reads gatewayUrl from env, so we set
 * it here from the config to keep a single source of truth.
 */
export async function startQueueWorker(config: Partial<QueueConfig> = {}): Promise<Worker> {
  const cfg = queueConfigFromEnv(config);

  // The activity uses env for the gateway URL (it runs outside the sandbox).
  process.env.OFFGRID_QUEUE_GATEWAY_URL = cfg.gatewayUrl;

  const connection = await NativeConnection.connect({ address: cfg.temporalAddress });

  const worker = await Worker.create({
    connection,
    namespace: cfg.namespace,
    taskQueue: cfg.taskQueue,
    // Temporal bundles the workflow file itself (do NOT let tsup touch it).
    // Resolve the emitted workflow module robustly: depending on whether the
    // worker is inlined into the entry (moduleDir = dist/) or kept separate
    // (moduleDir = dist/queue/), the file is at one of these candidates.
    workflowsPath: resolveWorkflowsPath(moduleDir),
    activities,
    // ── THE BACKPRESSURE CAP ──────────────────────────────────────────────
    // Max inference activities in flight against the pool from THIS worker.
    // Run one worker per node, each capped at that node's capacity.
    maxConcurrentActivityTaskExecutions: cfg.maxConcurrentPerNode,
  });

  await worker.run();
  return worker;
}
