// Durable APP-RUN WORKER — the drain for the `offgrid-apps` task queue (multi-step Studio apps).
//
// Sibling of scripts/temporal-worker.mts (the agent-run worker). Run as a SEPARATE long-lived
// process. It polls Temporal, runs AppRunWorkflow (the multi-step executor with mid-workflow
// human-in-the-loop pause/resume), and executes the app-run activities (which reuse runApp/runAgent
// + the connector rule engine). It imports @/lib/*, so it needs the console's runtime env.
//
// HOW TO RUN
//   1. A Temporal server reachable at OFFGRID_TEMPORAL_ADDRESS (default 127.0.0.1:7233).
//   2. From the console dir:  npm run worker:apps
//   3. Enable durable app dispatch on the console side with OFFGRID_QUEUE_ENABLED=1
//      (or OFFGRID_ADAPTER_APPRUNTIME=temporal). Without a running worker the console gracefully
//      falls back to synchronous in-process runApp (but a `human` step can only PAUSE durably, so
//      HITL apps need this worker running).
//
// ⚠️ IMPORT ORDER IS LOAD-BEARING: `./worker-env.mts` MUST be first (loads .env.* before @/db builds
// its pg Pool — see temporal-worker.mts for the full SASL rationale).

import { missingRequiredEnv, workerIdentityString } from './worker-env.mts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from '../src/worker/app-run.activities.ts';
import { appDurableConfigFromEnv } from '../src/lib/app-run-durable.ts';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsPath = join(here, '..', 'src', 'worker', 'app-run.workflow.ts');

async function main(): Promise<void> {
  const missing = missingRequiredEnv(process.env);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(
      `[app-worker] missing required env: ${missing.join(', ')}. Load the console's .env.local/.env.* ` +
        `(see scripts/worker-env.mts).`,
    );
    process.exit(1);
  }

  const cfg = appDurableConfigFromEnv(process.env);
  // eslint-disable-next-line no-console
  console.log(
    `[app-worker] connecting to Temporal ${cfg.temporalAddress} ns=${cfg.namespace} queue=${cfg.taskQueue}`,
  );

  const connection = await NativeConnection.connect({ address: cfg.temporalAddress });
  const worker = await Worker.create({
    identity: workerIdentityString(),
    connection,
    namespace: cfg.namespace,
    taskQueue: cfg.taskQueue,
    workflowsPath,
    activities,
    maxConcurrentActivityTaskExecutions: Number(process.env.OFFGRID_APP_MAX_CONCURRENT ?? '2'),
  });

  // eslint-disable-next-line no-console
  console.log('[app-worker] ready — draining app runs');
  await worker.run();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[app-worker] fatal', err);
  process.exit(1);
});
