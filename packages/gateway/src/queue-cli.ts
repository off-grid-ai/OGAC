#!/usr/bin/env node
// offgrid-gateway-queue — run a durable inference QUEUE worker (the drain).
//
// The async backpressure layer for AI workflows: Temporal holds queued
// inference requests durably and this worker drains them at the rate a node can
// absorb (maxConcurrentActivityTaskExecutions = per-node capacity). Run one
// worker per node, each pointed at its node's gateway URL. NOT the sync path.
//
//   OFFGRID_TEMPORAL_ADDRESS=s1.lan:7233 \
//   OFFGRID_TEMPORAL_NAMESPACE=default \
//   OFFGRID_QUEUE_TASK_QUEUE=offgrid-inference \
//   OFFGRID_QUEUE_MAX_CONCURRENT_PER_NODE=2 \
//   OFFGRID_QUEUE_GATEWAY_URL=http://localhost:8800 \
//   node dist/queue-cli.js
//
// Build caveat: Temporal bundles the workflow module (src/queue/workflow.ts)
// with its OWN determinism-preserving bundler at worker startup — tsup/esbuild
// must NOT touch it. The worker resolves ./workflow.js next to this CLI at
// runtime, so the queue module must be built with workflow.js emitted alongside
// (see package.json build entries). If running from source instead, use tsx:
//   OFFGRID_TEMPORAL_ADDRESS=… npx tsx src/queue-cli.ts
import { startQueueWorker } from './queue/worker';

startQueueWorker().catch((err) => {
  console.error('[offgrid-queue] worker failed:', err);
  process.exit(1);
});
