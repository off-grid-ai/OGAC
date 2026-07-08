// Durable CHAT-RUN WORKER — the drain for the `offgrid-chat` task queue (W1).
//
// Sibling of scripts/temporal-worker.mts (agent runs) + scripts/app-worker.mts (app runs). Run as a
// SEPARATE long-lived process. It polls Temporal, runs ChatRunWorkflow, and executes the chat-run
// activity (which reuses recordChatRunGovernance — the SAME lineage/provenance/audit fan-out the
// inline fallback runs). It imports @/lib/*, so it needs the console's runtime env.
//
// The chat MODEL call streams tokens from the Next route (SSE), so it stays inline; this worker only
// records the GOVERNED RUN durably (guardrail verdicts + trust artifacts). Without this worker
// running the console gracefully records the run in-process (chat-run-dispatch inline fallback).
//
// HOW TO RUN
//   1. A Temporal server reachable at OFFGRID_TEMPORAL_ADDRESS (default 127.0.0.1:7233).
//   2. From the console dir:  npm run worker:chat
//   3. Enable durable chat dispatch on the console side with OFFGRID_QUEUE_ENABLED=1
//      (or OFFGRID_ADAPTER_AGENTRUNTIME=temporal).
//
// ⚠️ IMPORT ORDER IS LOAD-BEARING: `./worker-env.mts` MUST be first (loads .env.* before @/db builds
// its pg Pool — see temporal-worker.mts for the full SASL rationale).

import { missingRequiredEnv } from './worker-env.mts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from '../src/worker/chat-run.activities.ts';
import { CHAT_TASK_QUEUE } from '../src/lib/chat-run.ts';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsPath = join(here, '..', 'src', 'worker', 'chat-run.workflow.ts');

async function main(): Promise<void> {
  const missing = missingRequiredEnv(process.env);
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(
      `[chat-worker] missing required env: ${missing.join(', ')}. Load the console's .env.local/.env.* ` +
        `(see scripts/worker-env.mts).`,
    );
    process.exit(1);
  }

  const address = process.env.OFFGRID_TEMPORAL_ADDRESS?.trim() || '127.0.0.1:7233';
  const namespace = process.env.OFFGRID_TEMPORAL_NAMESPACE?.trim() || 'default';
  const taskQueue = process.env.OFFGRID_CHAT_TASK_QUEUE?.trim() || CHAT_TASK_QUEUE;

  // eslint-disable-next-line no-console
  console.log(`[chat-worker] connecting to Temporal ${address} ns=${namespace} queue=${taskQueue}`);

  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities,
    maxConcurrentActivityTaskExecutions: Number(process.env.OFFGRID_CHAT_MAX_CONCURRENT ?? '4'),
  });

  // eslint-disable-next-line no-console
  console.log('[chat-worker] ready — draining chat runs');
  await worker.run();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[chat-worker] fatal', err);
  process.exit(1);
});
