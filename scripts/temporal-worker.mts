// Durable agent-run WORKER — the drain for the `offgrid-agents` task queue.
//
// Run this as a SEPARATE, long-lived process (NOT inside Next). It polls Temporal, runs the
// AgentRunWorkflow, and executes the runAgentPipeline activity (which reuses the real runAgent
// pipeline: policy → guardrails → retrieval → LLM → grounding → provenance → persist). Because it
// imports @/lib/agentrun, it needs the same runtime env as the console (DATABASE_URL, gateway
// creds, adapter config) — load .env.local / .env.production the same way the console does.
//
// HOW TO RUN
//   1. A Temporal server must be reachable at OFFGRID_TEMPORAL_ADDRESS (default offgrid-s1.local:7233).
//   2. From the console dir:  npm run worker:agents
//      (or:  OFFGRID_TEMPORAL_ADDRESS=host:7233 tsx scripts/temporal-worker.mts)
//   3. Enable durable dispatch on the console side with OFFGRID_QUEUE_ENABLED=1
//      (or OFFGRID_ADAPTER_AGENTRUNTIME=temporal). Without a running worker the console
//      gracefully falls back to synchronous in-process execution.
//
// This entrypoint is run with tsx so the "@/*" tsconfig path + type-stripping work; Temporal's own
// bundler compiles the workflow module (workflowsPath) with determinism preserved.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from '../src/worker/agent-run.activities.ts';
import { durableConfigFromEnv } from '../src/lib/agent-run-durable.ts';

// Load runtime config the way the console does (.env.local wins, then .env).
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const here = dirname(fileURLToPath(import.meta.url));
const workflowsPath = join(here, '..', 'src', 'worker', 'agent-run.workflow.ts');

async function main(): Promise<void> {
  const cfg = durableConfigFromEnv(process.env);
  // eslint-disable-next-line no-console
  console.log(
    `[agent-worker] connecting to Temporal ${cfg.temporalAddress} ns=${cfg.namespace} queue=${cfg.taskQueue}`,
  );

  const connection = await NativeConnection.connect({ address: cfg.temporalAddress });
  const worker = await Worker.create({
    connection,
    namespace: cfg.namespace,
    taskQueue: cfg.taskQueue,
    workflowsPath,
    activities,
    // One agent run in flight at a time per worker by default — the pipeline hits the gateway, so
    // sizing this to node capacity is the backpressure knob (run more workers to drain faster).
    maxConcurrentActivityTaskExecutions: Number(process.env.OFFGRID_AGENT_MAX_CONCURRENT ?? '2'),
  });

  // eslint-disable-next-line no-console
  console.log('[agent-worker] ready — draining agent runs');
  await worker.run();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[agent-worker] fatal', err);
  process.exit(1);
});
