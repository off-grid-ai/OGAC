import { Q as QueuedInferenceRequest, a as QueueConfig, b as QueueResult } from '../types-CctbDVCe.js';
export { queueConfigFromEnv, startQueueWorker } from './worker.js';
import '@temporalio/worker';

/**
 * Durably enqueue an inference request. Returns the workflowId immediately (the
 * request is now safe in Temporal); it will be drained when a worker slot opens.
 */
declare function enqueueInference(req: QueuedInferenceRequest, config?: Partial<QueueConfig>): Promise<string>;
/** Await the result of a previously enqueued inference workflow. */
declare function getResult(workflowId: string, config?: Partial<QueueConfig>): Promise<QueueResult>;

export { QueueConfig, QueueResult, QueuedInferenceRequest, enqueueInference, getResult };
