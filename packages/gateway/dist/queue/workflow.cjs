"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/queue/workflow.ts
var workflow_exports = {};
__export(workflow_exports, {
  inferenceWorkflow: () => inferenceWorkflow
});
module.exports = __toCommonJS(workflow_exports);
var import_workflow = require("@temporalio/workflow");
function makeInference(maxAttempts) {
  return (0, import_workflow.proxyActivities)({
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  inferenceWorkflow
});
