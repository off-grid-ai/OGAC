import { Worker } from '@temporalio/worker';
import { a as QueueConfig } from '../types-CctbDVCe.cjs';

/** Fill a QueueConfig from env (used by the standalone queue-cli entrypoint). */
declare function queueConfigFromEnv(o?: Partial<QueueConfig>): QueueConfig;
/**
 * Start the queue worker. Registers the workflow + activities on the task queue
 * with the backpressure concurrency cap. Returns the running Worker (call
 * worker.shutdown() to stop). The activity reads gatewayUrl from env, so we set
 * it here from the config to keep a single source of truth.
 */
declare function startQueueWorker(config?: Partial<QueueConfig>): Promise<Worker>;

export { queueConfigFromEnv, startQueueWorker };
