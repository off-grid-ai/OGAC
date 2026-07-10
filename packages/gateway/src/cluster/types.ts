// @offgrid/gateway — multinode cluster/router types.
//
// The single-node gateway (src/cli.ts) serves models on one box. The CLUSTER
// mode fans one OpenAI-compatible endpoint out across many node gateways,
// routing by model + modality, deriving true inference health, and capturing
// prompt-in/completion-out for observability. It runs standalone (its own CLI /
// Docker image) and is also imported by the Off Grid console as the backend of
// its multinode management plane.

/** One node gateway in the pool (a box running the single-node @offgrid/gateway on :7878). */
export interface GatewayNode {
  /** Stable short id, e.g. "g1". */
  name: string;
  host: string;
  port: number;
  /** The model this node serves (routing tag; the node's llama-server ignores the field). */
  model: string;
  /** Whether the node can serve image/vision-in requests. */
  vision?: boolean;
  /** When false, the router never targets this node (it still shows in health/management). */
  enabled?: boolean;
}

/** Derived inference health — NOT mere process liveness. */
export type Health = 'up' | 'degraded' | 'down' | 'unknown';

/** One captured proxied call (rolling log + per-node counters + durable shipping). */
export interface TrafficRecord {
  ts: number;
  gateway: string;
  model: string;
  modelServed?: string;
  kind: 'text' | 'image' | 'embedding';
  status: number;
  ms: number;
  bytes: number;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  tps?: number;
  /** Time-to-first-byte (ms) — the practical backpressure symptom; stretches under load. */
  ttfb?: number;
  /** How many times the downstream socket applied write-backpressure (client couldn't drain). */
  writeBlocked?: number;
  finish?: string;
  toolCalls?: { name: string; args: string }[];
  reasoning?: string;
  caller?: string;
  corrId?: string;
  params?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    thinking?: boolean;
    toolsOffered?: number;
  };
  msgs?: { role: string; text: string }[];
  input?: string;
  output?: string;
  /** Raw mode: all inbound HTTP request headers (set when OFFGRID_RAW_HEADERS=true). */
  requestHeaders?: Record<string, string>;
  /** Raw mode: all upstream HTTP response headers. */
  responseHeaders?: Record<string, string>;
}

/** Per-node rolled-up counters + derived health for the management/traffic views. */
export interface NodeStats {
  gateway: string;
  model: string;
  requests: number;
  errors: number;
  totalMs: number;
  avgMs: number;
  tokens: number;
  health: Health;
  /** Backpressure gauges: requests in-flight now, waiting in queue, and the peak seen. */
  inflight: number;
  queued: number;
  peakInflight: number;
}

export interface ClusterOptions {
  /** The node pool. Defaults to OFFGRID_POOL env (JSON) or a built-in demo pool. */
  pool?: GatewayNode[];
  port?: number;
  host?: string;
  /** Host shown in info URLs only (display). */
  hostHint?: string;
  /** OpenSearch base URL for durable, SIEM-searchable call logging (or null to disable). */
  openSearchUrl?: string | null;
  openSearchIndex?: string;
  /** Health-derivation tunables (all have env-var defaults). */
  health?: Partial<HealthConfig>;
  /** Extra observability sinks (analytics / finops / custom) added to the env-derived set. */
  sinks?: import('./observability').ObservabilitySink[];
  /** Policy pipeline (guardrails / rate limits / budgets / cache) — the middle layer. */
  policies?: import('../policy/types').Policy[];
  /**
   * Raw header logging mode. When true, every TrafficRecord includes the full
   * inbound request headers and upstream response headers. Useful for debugging
   * enterprise token passthrough and routing. Also enabled by OFFGRID_RAW_HEADERS=true.
   */
  rawHeaders?: boolean;
}

export interface HealthConfig {
  windowMs: number;
  slowMs: number;
  jamMs: number;
  degradedErrRate: number;
  downErrRate: number;
  probeEnabled: boolean;
  probeEveryMs: number;
  probeTimeoutMs: number;
}
