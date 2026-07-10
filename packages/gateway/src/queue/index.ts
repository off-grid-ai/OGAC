// @offgrid/gateway/queue — the durable async inference queue (Temporal-backed).
//
// The backpressure layer for AI WORKFLOWS (batch / agents / long generations),
// NOT the sync chat path. Saturated pools QUEUE durably and drain at the rate
// nodes can absorb (a worker's activity concurrency IS the cap). Kept on its own
// subpath because it pulls @temporalio + native bundler deps — importing the
// core gateway (createClusterGateway) must never drag those in.
//
// NOTE: ./workflow is intentionally NOT re-exported — Temporal's own bundler
// loads it via the worker's workflowsPath at runtime.
export { enqueueInference, getResult } from './client';
export { startQueueWorker, queueConfigFromEnv } from './worker';
export type { QueuedInferenceRequest, QueueResult, QueueConfig } from './types';
