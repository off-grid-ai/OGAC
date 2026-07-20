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

// src/queue/index.ts
var queue_exports = {};
__export(queue_exports, {
  enqueueInference: () => enqueueInference,
  getResult: () => getResult,
  queueConfigFromEnv: () => queueConfigFromEnv,
  startQueueWorker: () => startQueueWorker
});
module.exports = __toCommonJS(queue_exports);

// src/queue/client.ts
var import_client = require("@temporalio/client");

// src/queue/worker.ts
var import_node_url = require("url");
var import_node_path = require("path");
var import_node_fs = require("fs");
var import_worker = require("@temporalio/worker");

// src/queue/activities.ts
var activities_exports = {};
__export(activities_exports, {
  runInference: () => runInference
});
function gatewayUrl() {
  return process.env.OFFGRID_QUEUE_GATEWAY_URL || process.env.OFFGRID_GATEWAY_URL || "http://localhost:8800";
}
function queueGatewayHeaders(env = process.env) {
  const bearer = env.OFFGRID_QUEUE_GATEWAY_BEARER_TOKEN?.trim();
  if (bearer) return { authorization: `Bearer ${bearer}` };
  const apiKey = (env.OFFGRID_QUEUE_GATEWAY_API_KEY || env.OFFGRID_GATEWAY_API_KEY)?.trim();
  return apiKey ? { "x-api-key": apiKey } : {};
}
async function runInference(req) {
  const started = Date.now();
  const url = `${gatewayUrl().replace(/\/$/, "")}/v1/chat/completions`;
  const headers = { "content-type": "application/json", ...queueGatewayHeaders() };
  if (req.caller) headers["x-offgrid-caller"] = req.caller;
  if (req.corrId) headers["x-offgrid-corr-id"] = req.corrId;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(req.body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`inference ${res.status}: ${text.slice(0, 500)}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`inference returned non-JSON body (${res.status})`);
  }
  return { status: res.status, body, ms: Date.now() - started };
}

// src/queue/worker.ts
var import_meta = {};
var moduleDir = typeof __dirname !== "undefined" ? __dirname : (0, import_node_path.dirname)((0, import_node_url.fileURLToPath)(import_meta.url));
function resolveWorkflowsPath(base) {
  const candidates = [
    (0, import_node_path.join)(base, "workflow.js"),
    (0, import_node_path.join)(base, "queue", "workflow.js"),
    (0, import_node_path.join)(base, "workflow.cjs"),
    (0, import_node_path.join)(base, "queue", "workflow.cjs")
  ];
  return candidates.find((p) => (0, import_node_fs.existsSync)(p)) ?? candidates[0];
}
function queueConfigFromEnv(o = {}) {
  const n = (v, d) => v == null ? d : Number(v);
  return {
    temporalAddress: o.temporalAddress ?? process.env.OFFGRID_TEMPORAL_ADDRESS ?? "localhost:7233",
    namespace: o.namespace ?? process.env.OFFGRID_TEMPORAL_NAMESPACE ?? "default",
    taskQueue: o.taskQueue ?? process.env.OFFGRID_QUEUE_TASK_QUEUE ?? "offgrid-inference",
    maxConcurrentPerNode: o.maxConcurrentPerNode ?? n(process.env.OFFGRID_QUEUE_MAX_CONCURRENT_PER_NODE, 2),
    maxAttempts: o.maxAttempts ?? n(process.env.OFFGRID_QUEUE_MAX_ATTEMPTS, 5),
    gatewayUrl: o.gatewayUrl ?? process.env.OFFGRID_QUEUE_GATEWAY_URL ?? process.env.OFFGRID_GATEWAY_URL ?? "http://localhost:8800"
  };
}
async function startQueueWorker(config = {}) {
  const cfg = queueConfigFromEnv(config);
  process.env.OFFGRID_QUEUE_GATEWAY_URL = cfg.gatewayUrl;
  const connection = await import_worker.NativeConnection.connect({ address: cfg.temporalAddress });
  const worker = await import_worker.Worker.create({
    connection,
    namespace: cfg.namespace,
    taskQueue: cfg.taskQueue,
    // Temporal bundles the workflow file itself (do NOT let tsup touch it).
    // Resolve the emitted workflow module robustly: depending on whether the
    // worker is inlined into the entry (moduleDir = dist/) or kept separate
    // (moduleDir = dist/queue/), the file is at one of these candidates.
    workflowsPath: resolveWorkflowsPath(moduleDir),
    activities: activities_exports,
    // ── THE BACKPRESSURE CAP ──────────────────────────────────────────────
    // Max inference activities in flight against the pool from THIS worker.
    // Run one worker per node, each capped at that node's capacity.
    maxConcurrentActivityTaskExecutions: cfg.maxConcurrentPerNode
  });
  await worker.run();
  return worker;
}

// src/queue/client.ts
var cached = null;
async function clientFor(cfg) {
  const key = `${cfg.temporalAddress}/${cfg.namespace}`;
  if (cached?.key === key) return cached.client;
  const connection = await import_client.Connection.connect({ address: cfg.temporalAddress });
  const client = new import_client.Client({ connection, namespace: cfg.namespace });
  cached = { key, client };
  return client;
}
async function enqueueInference(req, config = {}) {
  const cfg = queueConfigFromEnv(config);
  const client = await clientFor(cfg);
  const workflowId = `inf-${req.corrId ?? cryptoRandom()}`;
  await client.workflow.start("inferenceWorkflow", {
    taskQueue: cfg.taskQueue,
    workflowId,
    args: [req, cfg.maxAttempts]
  });
  return workflowId;
}
async function getResult(workflowId, config = {}) {
  const cfg = queueConfigFromEnv(config);
  const client = await clientFor(cfg);
  const handle = client.workflow.getHandle(workflowId);
  return handle.result();
}
function cryptoRandom() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  enqueueInference,
  getResult,
  queueConfigFromEnv,
  startQueueWorker
});
