// ─── PURE LiteLLM STRUCTURED-CALLBACKS logic — ZERO I/O, exhaustively unit-testable ──────────────
//
// LiteLLM Proxy fans EVERY completed model call to its configured logging CALLBACKS (the
// `litellm_settings.success_callback` / `failure_callback` sinks) — model, tokens, cost, latency,
// metadata, success/failure — turning the gateway into a real-time observable + auditable stream.
// Sinks are things like Langfuse / OpenTelemetry (OTel) / S3 / a generic webhook.
//
// LIVE-PROBE FINDINGS (deployed g5 proxy, http://192.168.1.65:4000 — verified 2026-07):
//   • GET  /callbacks/list      → { success[], failure[], success_and_failure[] }  (master-key gated)
//   • GET  /active/callbacks    → free-form active-callbacks dict                   (master-key gated)
//   • POST /team/{id}/callback  → runtime-settable, TEAM-SCOPED callback add        (AddTeamCallback)
//   • POST /team/{id}/disable_logging → runtime team logging disable
//   • There is NO global runtime `POST /config/callbacks` on this version (404). The GLOBAL
//     success/failure callbacks are DEPLOY-owned (config file + proxy reload) — the deploy config
//     declares success_callback:[otel], failure_callback:[otel].
//
// So this surface is HONEST (same pattern as the response-cache surface): it READS the live active
// callbacks, classifies each sink + its role, and is explicit that the GLOBAL callbacks are
// deploy-owned/reload-required — while exposing the ONE runtime-supported write the proxy actually
// has: a team-scoped callback set. All I/O lives in adapters/litellm-callbacks.ts; this file NEVER
// fetches — it is fed raw JSON and returns terminal, asserted shapes.
//
// Payload preview reuses the EXISTING pure mapper (litellm-log-shape.ts) — we do NOT duplicate the
// per-call record shape; we import it to show operators exactly what a structured callback record
// looks like as it lands in the console traffic stream.
import {
  type LiteLLMStandardLoggingPayload,
  litellmPayloadToTrafficRecord,
} from '@/lib/litellm-log-shape';
import type { TrafficRecord } from '@offgrid/analytics';

// ─── sink classification ──────────────────────────────────────────────────────────────────────────

/** The role a callback sink plays — drives how the UI groups + explains it. */
export type SinkCategory = 'observability' | 'metrics' | 'storage' | 'alerting' | 'unknown';

/** A single classified callback sink (one entry in success_callback / failure_callback). */
export interface CallbackSink {
  /** The raw LiteLLM callback name (e.g. 'otel', 'langfuse', 's3'). */
  name: string;
  /** What kind of sink it is — observability / metrics / storage / alerting. */
  category: SinkCategory;
  /** A human label for the sink ('OpenTelemetry', 'Langfuse', …); falls back to the raw name. */
  label: string;
  /** Whether the sink is fed on successful calls. */
  onSuccess: boolean;
  /** Whether the sink is fed on failed calls. */
  onFailure: boolean;
}

interface KnownSink {
  label: string;
  category: SinkCategory;
}

// The LiteLLM logging integrations we recognize. Names mirror LiteLLM's callback identifiers. Unknown
// names still render (as category 'unknown') — we never hide a configured sink.
const KNOWN_SINKS: Readonly<Record<string, KnownSink>> = {
  otel: { label: 'OpenTelemetry', category: 'observability' },
  opentelemetry: { label: 'OpenTelemetry', category: 'observability' },
  langfuse: { label: 'Langfuse', category: 'observability' },
  langsmith: { label: 'LangSmith', category: 'observability' },
  lunary: { label: 'Lunary', category: 'observability' },
  arize: { label: 'Arize', category: 'observability' },
  arize_phoenix: { label: 'Arize Phoenix', category: 'observability' },
  phoenix: { label: 'Phoenix', category: 'observability' },
  traceloop: { label: 'Traceloop', category: 'observability' },
  literalai: { label: 'Literal AI', category: 'observability' },
  opik: { label: 'Opik', category: 'observability' },
  mlflow: { label: 'MLflow', category: 'observability' },
  langtrace: { label: 'Langtrace', category: 'observability' },
  helicone: { label: 'Helicone', category: 'observability' },
  braintrust: { label: 'Braintrust', category: 'observability' },
  logfire: { label: 'Logfire', category: 'observability' },
  prometheus: { label: 'Prometheus', category: 'metrics' },
  datadog: { label: 'Datadog', category: 'metrics' },
  datadog_llm_observability: { label: 'Datadog LLM Observability', category: 'metrics' },
  dynatrace: { label: 'Dynatrace', category: 'metrics' },
  s3: { label: 'S3', category: 'storage' },
  gcs_bucket: { label: 'GCS bucket', category: 'storage' },
  azure_storage: { label: 'Azure Storage', category: 'storage' },
  sentry: { label: 'Sentry', category: 'alerting' },
  slack: { label: 'Slack', category: 'alerting' },
  discord: { label: 'Discord', category: 'alerting' },
  pagerduty: { label: 'PagerDuty', category: 'alerting' },
  webhook: { label: 'Webhook', category: 'alerting' },
  generic: { label: 'Generic webhook', category: 'alerting' },
};

/** Classify a raw callback name into its {label, category}. Unknown ⇒ raw name + 'unknown'. PURE. */
export function classifySink(rawName: string): { label: string; category: SinkCategory } {
  const key = rawName.trim().toLowerCase();
  const known = KNOWN_SINKS[key];
  if (known) return { label: known.label, category: known.category };
  return { label: rawName.trim() || 'unknown', category: 'unknown' };
}

// ─── active-callbacks normalization ─────────────────────────────────────────────────────────────

/** The shape LiteLLM's GET /callbacks/list returns (CallbacksByType). All arrays optional. */
export interface RawCallbacksByType {
  success?: unknown;
  failure?: unknown;
  success_and_failure?: unknown;
  [k: string]: unknown;
}

/** The terminal, safe callbacks-status shape the UI + routes consume. */
export interface CallbacksStatus {
  /** OFFGRID_LITELLM_URL is set — the console CAN talk to a proxy. */
  configured: boolean;
  /** The proxy answered the callbacks endpoint. */
  reachable: boolean;
  /** True iff at least one callback sink is active (the gateway IS streaming per-call records). */
  active: boolean;
  /** Sinks fed on successful calls. */
  success: CallbackSink[];
  /** Sinks fed on failed calls. */
  failure: CallbackSink[];
  /** Present when the proxy could not be reached / errored. */
  error?: string;
}

/** Coerce arbitrary JSON to a list of non-empty, trimmed, de-duped string sink-names. PURE. */
function toNameList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(
      v
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s !== ''),
    ),
  ];
}

/** Merge two name-lists (dedupe, order-stable: first list, then new names from second). PURE. */
function mergeNames(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/**
 * Build the classified success/failure sink lists from a CallbacksByType response. A name in
 * `success_and_failure` feeds BOTH streams, so it appears in success AND failure with the matching
 * flags. PURE.
 */
export function classifyCallbacks(raw: RawCallbacksByType | null | undefined): {
  success: CallbackSink[];
  failure: CallbackSink[];
} {
  const both = toNameList(raw?.success_and_failure);
  const successNames = mergeNames(toNameList(raw?.success), both);
  const failureNames = mergeNames(toNameList(raw?.failure), both);
  const success = successNames.map((name) => {
    const c = classifySink(name);
    return { name, label: c.label, category: c.category, onSuccess: true, onFailure: failureNames.includes(name) };
  });
  const failure = failureNames.map((name) => {
    const c = classifySink(name);
    return { name, label: c.label, category: c.category, onSuccess: successNames.includes(name), onFailure: true };
  });
  return { success, failure };
}

/** Interpret a successful callbacks read into the terminal CallbacksStatus. PURE. */
export function interpretCallbacks(raw: RawCallbacksByType | null | undefined): CallbacksStatus {
  const { success, failure } = classifyCallbacks(raw);
  return {
    configured: true,
    reachable: true,
    active: success.length > 0 || failure.length > 0,
    success,
    failure,
  };
}

/** Status when OFFGRID_LITELLM_URL is unset — the console can't reach any proxy. PURE. */
export function callbacksUnconfigured(): CallbacksStatus {
  return { configured: false, reachable: false, active: false, success: [], failure: [] };
}

/** Status when the proxy is configured but the callbacks read failed (unreachable / 404 / error). PURE. */
export function callbacksUnreachable(error: string): CallbacksStatus {
  return { configured: true, reachable: false, active: false, success: [], failure: [], error };
}

// ─── team-callback set request (the one runtime-supported write) ────────────────────────────────

/** Callback stream a team-scoped callback attaches to. Mirrors LiteLLM's AddTeamCallback.callback_type. */
export type TeamCallbackType = 'success' | 'failure' | 'success_and_failure';

const TEAM_CALLBACK_TYPES: readonly TeamCallbackType[] = ['success', 'failure', 'success_and_failure'];

/** What the team-callback route accepts (raw, untrusted). */
export interface TeamCallbackInput {
  teamId?: unknown;
  callbackName?: unknown;
  callbackType?: unknown;
  /** Extra callback config (e.g. langfuse_public_key) — string→string, per LiteLLM's callback_vars. */
  callbackVars?: unknown;
}

/** The body POSTed to /team/{teamId}/callback, plus the validated path param + audit resource. */
export type TeamCallbackPlan =
  | {
      ok: true;
      teamId: string;
      body: { callback_name: string; callback_type: TeamCallbackType; callback_vars: Record<string, string> };
    }
  | { ok: false; error: string };

/** Coerce a raw callback_vars object → a clean string→string map (drops non-string values). PURE. */
function normalizeVars(v: unknown): Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = k.trim();
    if (key !== '' && typeof val === 'string') out[key] = val;
  }
  return out;
}

/**
 * Validate + shape a team-callback set request into the plan the adapter POSTs. Rejects a missing
 * team id or callback name, and an unrecognized callback_type (defaults to 'success_and_failure' when
 * omitted). callback_vars is optional and coerced to a string→string map. PURE.
 */
export function planTeamCallback(input: TeamCallbackInput): TeamCallbackPlan {
  const teamId = typeof input.teamId === 'string' ? input.teamId.trim() : '';
  if (teamId === '') return { ok: false, error: 'teamId is required' };
  const callbackName = typeof input.callbackName === 'string' ? input.callbackName.trim() : '';
  if (callbackName === '') return { ok: false, error: 'callbackName is required' };
  let callbackType: TeamCallbackType = 'success_and_failure';
  if (input.callbackType !== undefined && input.callbackType !== null) {
    const t = typeof input.callbackType === 'string' ? input.callbackType.trim() : '';
    if (!(TEAM_CALLBACK_TYPES as readonly string[]).includes(t)) {
      return { ok: false, error: "callbackType must be 'success', 'failure', or 'success_and_failure'" };
    }
    callbackType = t as TeamCallbackType;
  }
  return {
    ok: true,
    teamId,
    body: { callback_name: callbackName, callback_type: callbackType, callback_vars: normalizeVars(input.callbackVars) },
  };
}

/** A resource label for the audit trail describing a team-callback set. PURE. */
export function teamCallbackAuditResource(plan: Extract<TeamCallbackPlan, { ok: true }>): string {
  return `gateway.callbacks.team(${plan.teamId}).${plan.body.callback_name}`;
}

/** Validate the team id for the disable-logging (delete) path. PURE. */
export function planDisableTeamLogging(teamId: unknown): { ok: true; teamId: string } | { ok: false; error: string } {
  const id = typeof teamId === 'string' ? teamId.trim() : '';
  return id === '' ? { ok: false, error: 'teamId is required' } : { ok: true, teamId: id };
}

// ─── structured-callback payload preview (reuses litellm-log-shape — DRY) ───────────────────────

/**
 * A representative StandardLoggingPayload matching what LiteLLM fans to a callback for one successful
 * on-prem completion — used to SHOW operators the per-call record the gateway streams. Deterministic
 * (fixed times) so the preview + its test are stable. PURE.
 */
export function sampleCallbackPayload(): LiteLLMStandardLoggingPayload {
  return {
    id: 'chatcmpl-8Zx2example',
    model: 'onprem/qwen3.5-9b',
    model_group: 'qwen3.5-9b',
    call_type: 'completion',
    status: 'success',
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_000_842,
    total_tokens: 384,
    prompt_tokens: 128,
    completion_tokens: 256,
    response_cost: 0,
    metadata: {
      user_api_key_alias: 'suraksha-claims-app',
      user_api_key_user_id: 'app:claims-triage',
      deployment: 'g5',
      model_info: { id: 'g5', egress: 'on-prem', origin: 'g5' },
    },
  };
}

/**
 * The terminal TrafficRecord a structured callback maps to — the SAME shape the console traffic
 * stream renders. Produced by the existing pure mapper (litellm-log-shape.ts), NOT re-derived here.
 * PURE.
 */
export function sampleCallbackRecord(now?: number): TrafficRecord {
  return litellmPayloadToTrafficRecord(sampleCallbackPayload(), now);
}
