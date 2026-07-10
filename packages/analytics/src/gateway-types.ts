// @offgrid/analytics — gateway-types
//
// Structural mirror of the observability types exposed by @offgrid/gateway.
// These are intentionally re-declared here (NOT imported) so this package has
// zero runtime/build dependency on the gateway: it only needs the *shape* of a
// traffic record and a sink to interoperate. Keep in sync with @offgrid/gateway.

/** One completed unit of gateway traffic (a single model call). */
export interface TrafficRecord {
  /** Epoch milliseconds the record was emitted. */
  ts: number;
  /** Logical gateway/node id that served the request. */
  gateway: string;
  /** Model the caller asked for. */
  model: string;
  /** Model actually served (may differ from `model` after routing/aliasing). */
  modelServed?: string;
  /** High-level workload kind. */
  kind: 'text' | 'image' | 'embedding';
  /** HTTP-style status code (200 = ok, >=400 = error). */
  status: number;
  /** Wall-clock latency in milliseconds. */
  ms: number;
  /** Payload size in bytes (best effort). */
  bytes: number;
  /** Total tokens (prompt + completion) when known. */
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  /** Tokens per second for the generation. */
  tps?: number;
  /** Finish reason (e.g. "stop", "length", "tool_calls"). */
  finish?: string;
  /** Identifier of the calling app/user. */
  caller?: string;
  /** Correlation id for tracing across hops. */
  corrId?: string;
  /** Request parameters, when captured. */
  params?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    thinking?: boolean;
    toolsOffered?: number;
  };
  /** Raw input text (may be redacted/omitted by the gateway). */
  input?: string;
  /** Raw output text (may be redacted/omitted by the gateway). */
  output?: string;
}

/**
 * A destination for traffic records. The gateway fans each completed record out
 * to every registered sink. Implementations must be non-blocking and fail-open:
 * `record` should never throw and never slow the request path.
 */
export interface ObservabilitySink {
  readonly name: string;
  record(e: TrafficRecord): void;
}
