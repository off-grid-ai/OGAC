// PURE LiteLLM logging-callback → console TrafficRecord MAPPER — ZERO I/O, exhaustively unit-testable.
//
// LiteLLM Proxy fans every completed call to its logging callbacks with a StandardLoggingPayload. To
// keep the EXISTING console traffic/logs UI working UNCHANGED, we map that payload into the console's
// canonical `TrafficRecord` (the @offgrid/analytics shape) so it lands in the SAME `offgrid-gateway`
// OpenSearch index the UI already reads — DRY: we do NOT fork the record shape, we import it.
//
// The actual write (the OpenSearch POST) is done by a thin custom-callback shim in the deployment;
// this module is the pure translation it calls. Because it is pure it is unit-testable against fixed
// payloads (success, error, missing cost/tokens) and asserts the TERMINAL record that lands in the
// index — never an intermediate shape.
import type { TrafficRecord } from '@offgrid/analytics';

/**
 * The subset of LiteLLM's StandardLoggingPayload the console cares about. LiteLLM emits far more; we
 * declare only the fields we map (all optional — a partial/older LiteLLM payload degrades to zeros,
 * never throws). Field names mirror LiteLLM's documented StandardLoggingPayload.
 */
export interface LiteLLMStandardLoggingPayload {
  /** The public model_name the caller requested. */
  model?: string;
  /** The upstream model actually served (LiteLLM resolves the deployment). */
  model_group?: string;
  /** Total $ cost LiteLLM computed for the call (may be absent for local/free deployments). */
  response_cost?: number;
  /** LiteLLM call status: 'success' | 'failure'. */
  status?: string;
  /** Millisecond epochs LiteLLM stamps at start/end of the call. */
  startTime?: number;
  endTime?: number;
  /** Token usage block. */
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  /** The virtual/api key hash + end-user id LiteLLM attributes the call to. */
  metadata?: {
    user_api_key_alias?: string | null;
    user_api_key?: string | null;
    user_api_key_user_id?: string | null;
    /** The deployment LiteLLM routed to (its model_info.id from the config). */
    deployment?: string | null;
    /** LiteLLM populates model_info from the config's model_info block. */
    model_info?: { id?: string; egress?: string; origin?: string } | null;
  } | null;
  /** LiteLLM's request id (correlation across hops). */
  id?: string;
  /** On failure, the upstream/HTTP status code LiteLLM saw (when available). */
  error_code?: number | string | null;
  /** LiteLLM call type: 'completion' | 'embedding' | 'image_generation' | … */
  call_type?: string;
}

/** LiteLLM call_type → the console TrafficRecord `kind`. Unknown ⇒ 'text' (the common case). PURE. */
export function callTypeToKind(callType: string | undefined): TrafficRecord['kind'] {
  if (callType === 'embedding' || callType === 'aembedding') return 'embedding';
  if (callType === 'image_generation' || callType === 'aimage_generation') return 'image';
  return 'text';
}

/**
 * Derive the HTTP-style status the console records. LiteLLM `status:'success'` ⇒ 200. On failure we
 * use LiteLLM's numeric `error_code` when it is a real HTTP code (>=400), else a generic 500 — so a
 * failed call is ALWAYS recorded as an error the analytics rollups count (status>=400), never as ok.
 * PURE.
 */
export function deriveStatus(payload: LiteLLMStandardLoggingPayload): number {
  if (payload.status === 'success') return 200;
  const code = Number(payload.error_code);
  return Number.isFinite(code) && code >= 400 ? code : 500;
}

/** Non-negative finite number, or 0 — LiteLLM may omit cost/tokens for local deployments. PURE. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Map ONE LiteLLM StandardLoggingPayload → the console's canonical TrafficRecord — the TERMINAL
 * artifact that lands in the offgrid-gateway index and drives the existing traffic/logs UI. PURE.
 *
 * - `ts`      = LiteLLM's endTime (ms), else `now` (injectable for deterministic tests).
 * - `gateway` = the deployment id LiteLLM routed to (model_info.id / metadata.deployment) so the UI
 *               attributes traffic to the right fleet node / cloud provider; falls back to 'litellm'.
 * - `model`   = requested model_name; `modelServed` = the resolved model_group (may differ).
 * - `status`  = 200 on success, the real error code (or 500) on failure — analytics count errors.
 * - `ms`      = endTime - startTime when both present, else 0.
 * - `tokens`  = total (or prompt+completion), with the prompt/completion split preserved.
 * - `caller`  = the key alias / end-user id LiteLLM attributed the call to (never the raw key value).
 *
 * The $ cost LiteLLM computes is NOT forced into the TrafficRecord (which has no cost field) — that
 * would be a shape-hack that drifts the canonical type. Cost + budgets live in LiteLLM's own key
 * store and are read back by the adapter's `/key/info`; the console FinOps model derives cost from
 * tokens × model rates, exactly as it does for the aggregator today. The record shape stays
 * byte-compatible with what the aggregator already writes into offgrid-gateway.
 */
export function litellmPayloadToTrafficRecord(
  payload: LiteLLMStandardLoggingPayload,
  now: number = Date.now(),
): TrafficRecord {
  const meta = payload.metadata ?? {};
  const info = meta.model_info ?? {};
  const gateway = (info.id ?? meta.deployment ?? '').trim() || 'litellm';
  const ms =
    typeof payload.startTime === 'number' && typeof payload.endTime === 'number'
      ? Math.max(0, payload.endTime - payload.startTime)
      : 0;
  const total = num(payload.total_tokens) || num(payload.prompt_tokens) + num(payload.completion_tokens);
  const caller = (meta.user_api_key_alias ?? meta.user_api_key_user_id ?? '').trim();

  const record: TrafficRecord = {
    ts: typeof payload.endTime === 'number' ? payload.endTime : now,
    gateway,
    model: (payload.model ?? '').trim() || 'unknown',
    modelServed: (payload.model_group ?? '').trim() || undefined,
    kind: callTypeToKind(payload.call_type),
    status: deriveStatus(payload),
    ms,
    bytes: 0,
    tokens: total,
    promptTokens: payload.prompt_tokens !== undefined ? num(payload.prompt_tokens) : undefined,
    completionTokens:
      payload.completion_tokens !== undefined ? num(payload.completion_tokens) : undefined,
    caller: caller || undefined,
    corrId: (payload.id ?? '').trim() || undefined,
  };
  return record;
}
