#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/queue/worker.ts
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { Worker, NativeConnection } from "@temporalio/worker";

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
var moduleDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
function resolveWorkflowsPath(base) {
  const candidates = [
    join(base, "workflow.js"),
    join(base, "queue", "workflow.js"),
    join(base, "workflow.cjs"),
    join(base, "queue", "workflow.cjs")
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
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
  const connection = await NativeConnection.connect({ address: cfg.temporalAddress });
  const worker = await Worker.create({
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

// src/queue-cli.ts
startQueueWorker().catch((err) => {
  console.error("[offgrid-queue] worker failed:", err);
  process.exit(1);
});
