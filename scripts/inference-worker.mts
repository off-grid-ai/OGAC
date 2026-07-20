// Durable INFERENCE WORKER — authenticated drain for the `offgrid-inference` Temporal queue.
//
// The package worker owns backpressure and inference retries; this Console entrypoint owns runtime
// configuration. Loading worker-env first gives the machine client the same gateway URL and secret
// as the Console without embedding credentials in launchd or a tracked file.

import { missingRequiredEnv } from './worker-env.mts';
import { startQueueWorker } from '@offgrid/gateway/queue';

async function main(): Promise<void> {
  const missing = missingRequiredEnv(process.env, [
    'OFFGRID_GATEWAY_URL',
    'OFFGRID_GATEWAY_API_KEY',
  ]);
  if (missing.length) {
    console.error(
      `[inference-worker] missing required env: ${missing.join(', ')}. ` +
        'The worker loads the Console runtime env through scripts/worker-env.mts.',
    );
    process.exit(1);
  }

  console.log(
    `[inference-worker] connecting to Temporal ${process.env.OFFGRID_TEMPORAL_ADDRESS ?? 'localhost:7233'} ` +
      `queue=${process.env.OFFGRID_QUEUE_TASK_QUEUE ?? 'offgrid-inference'}`,
  );
  await startQueueWorker();
}

main().catch((error) => {
  console.error('[inference-worker] fatal', error);
  process.exit(1);
});
