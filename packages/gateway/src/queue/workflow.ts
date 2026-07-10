// @offgrid/gateway — queue WORKFLOW.
//
// A Temporal workflow is DETERMINISTIC and runs inside a v8 sandbox: it may NOT
// do I/O, use `fetch`, read env, or import Node modules. It only orchestrates —
// here it proxies the request to the `runInference` activity with a retry policy
// and timeouts. Durability + retries + backpressure come for free: if the whole
// fleet is down the workflow simply sits in the queue and resumes on recovery.
//
// IMPORTANT (build caveat): this file must be bundled by Temporal's own
// workflow bundler (@temporalio/worker Worker.create bundles it), NOT by tsup.
// tsup/esbuild strip the determinism guarantees Temporal needs, so we DO NOT add
// this file to the tsup entry list. The worker loads it from source/path at
// runtime (see worker.ts). Keep this file self-contained: import ONLY from
// @temporalio/workflow and local ./types (type-only).

import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import type { QueuedInferenceRequest, QueueResult } from './types';

// Retry + timeout policy. maxAttempts is injected via the workflow arg so the
// same bundled workflow honours the deployment's QueueConfig.maxAttempts.
function makeInference(maxAttempts: number) {
  return proxyActivities<typeof activities>({
    // Generous — a queued/batch generation can be long. The sync path has its
    // own fast timeout; this async path prizes completion over latency.
    startToCloseTimeout: '10 minutes',
    // If a worker crashes mid-activity, reschedule after this heartbeat gap.
    scheduleToCloseTimeout: '1 hour',
    retry: {
      initialInterval: '2s',
      backoffCoefficient: 2,
      maximumInterval: '1m',
      maximumAttempts: maxAttempts,
      // 503-from-saturation and transport errors are all retryable by default.
    },
  }).runInference;
}

/** The durable inference workflow. Awaited by the client via getResult(). */
export async function inferenceWorkflow(
  req: QueuedInferenceRequest,
  maxAttempts = 5,
): Promise<QueueResult> {
  const runInference = makeInference(maxAttempts);
  return runInference(req);
}
