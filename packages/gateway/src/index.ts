// @offgrid/gateway — public API.
//
// The local, OpenAI-compatible gateway runtime, extracted from Off Grid AI
// Desktop so it can run BOTH embedded (Electron desktop injects its paths) and
// standalone (the offgrid-gateway CLI / Docker image).
//
// Status: v0.1 — the host-agnostic config seam (runtime-env) lands first; the
// inference handlers (chat/vision/image/audio/embeddings) migrate from
// desktop/src/main in the next step, exposed via createGatewayServer().

export {
  configureRuntime,
  dataDir,
  modelsDir,
  binRoots,
  resourceDirs,
  resourceFile,
  appRoot,
  isPackaged,
  onHostQuit,
} from './runtime-env';

// Multinode cluster/router — the standalone entity that fans one OpenAI-compatible
// endpoint across a pool of node gateways, with true health + plug-and-play
// observability. Importable by the console for its multinode management plane.
export { createClusterGateway } from './cluster/server';
export type { ClusterGateway } from './cluster/server';
export { HealthMonitor, healthConfig } from './cluster/health';
export { TrafficStore } from './cluster/capture';
export { Router, hasImage } from './cluster/router';
// Admission control — in-process backpressure guard on the sync path (per-node
// concurrency cap + bounded queue + load-aware routing). Durable QUEUED
// inference (batch/agents) belongs on Temporal as a separate async layer.
export { AdmissionLimiter, limiterConfig, Saturated } from './cluster/limiter';
export type { LimiterConfig } from './cluster/limiter';
export {
  openSearchSink,
  langfuseSink,
  stdoutSink,
  sinksFromEnv,
  type ObservabilitySink,
} from './cluster/observability';
export * as clusterModels from './cluster/models';
// Policy layer interface (the middle layer). Concrete policies — guardrails,
// rate limits, budgets, caching — ship as the @offgrid/policy package and plug
// in via ClusterOptions.policies; analytics/finops plug in via sinks.
export { runPre, runPost } from './policy/types';
export type { Policy, PolicyContext, PolicyOutcome } from './policy/types';
// Built-in policies — plug into ClusterOptions.policies.
// clientAuth: forward an enterprise client's own cloud-provider token (Bearer or
// x-api-key) to the upstream, while preserving the original client IP.
export { clientAuth, TokenStore } from './policy/client-auth';
export type { ClientAuthOptions, TokenEntry, InferredToken } from './policy/client-auth';
export { keycloakAuth } from './policy/keycloak-auth';
export type { KeycloakAuthOptions } from './policy/keycloak-auth';
export { KeycloakValidator, getValidator, keycloakConfigFromEnv } from './cluster/keycloak';
export type { KeycloakConfig, JWTClaims } from './cluster/keycloak';
export type {
  GatewayNode,
  Health,
  TrafficRecord,
  NodeStats,
  ClusterOptions,
  HealthConfig,
} from './cluster/types';

// The durable async inference QUEUE (Temporal-backed) lives at the subpath
// `@offgrid/gateway/queue` — NOT here. It pulls @temporalio (and its native
// bundler deps), so keeping it off the main entry means importing
// createClusterGateway never drags Temporal into a consumer's bundle.

export const version = '0.1.0';
