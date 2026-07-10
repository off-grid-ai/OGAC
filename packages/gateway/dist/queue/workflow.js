// src/queue/workflow.ts
import { proxyActivities } from "@temporalio/workflow";
function makeInference(maxAttempts) {
  return proxyActivities({
    // Generous — a queued/batch generation can be long. The sync path has its
    // own fast timeout; this async path prizes completion over latency.
    startToCloseTimeout: "10 minutes",
    // If a worker crashes mid-activity, reschedule after this heartbeat gap.
    scheduleToCloseTimeout: "1 hour",
    retry: {
      initialInterval: "2s",
      backoffCoefficient: 2,
      maximumInterval: "1m",
      maximumAttempts: maxAttempts
      // 503-from-saturation and transport errors are all retryable by default.
    }
  }).runInference;
}
async function inferenceWorkflow(req, maxAttempts = 5) {
  const runInference = makeInference(maxAttempts);
  return runInference(req);
}
export {
  inferenceWorkflow
};
