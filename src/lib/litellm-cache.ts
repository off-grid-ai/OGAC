// ─── PURE LiteLLM RESPONSE-CACHE logic — ZERO I/O, exhaustively unit-testable ─────────────────────
//
// LiteLLM (the DB-backed proxy) can front completions with a RESPONSE CACHE (redis / local / s3),
// configured in the proxy's `litellm_settings.cache` block and exposed at runtime over a small API:
//   GET  /cache/ping        — is the cache reachable + what type is it
//   POST /cache/delete      — evict specific keys
//   POST /cache/flushall    — clear the whole cache (redis FLUSHALL)
// The cache POLICY (ttl, supported_call_types, which cache) is set at DEPLOY time and needs a proxy
// reload to change — so this surface is HONEST about that: it shows the live runtime status + flush
// levers, and reads any policy the ping echoes back as read-only ("configured at deploy / reload
// required"), never faking a live toggle.
//
// Observability: LiteLLM stamps each /spend/logs row with a `cache_hit` marker WHEN response-caching
// is active. This module derives a REAL hit-rate + tokens/cost "saved" from those rows — but only
// counts a row as a decided hit/miss when the marker is actually present. If the deployed version /
// config never stamps it, `decided` is 0 and the UI must say "not reported on this deployment"
// rather than inventing a hit-rate.
//
// All I/O (calling /cache/*, reading /spend/logs) lives in adapters/litellm-cache.ts. This file NEVER
// fetches — it is fed raw JSON and returns terminal, asserted shapes.

// ─── cache status (/cache/ping normalization) ─────────────────────────────────────────────────────

/** The cache backends LiteLLM can be configured with. Unknown strings pass through as 'unknown'. */
export type CacheType = 'redis' | 'redis-semantic' | 'local' | 's3' | 'qdrant-semantic' | 'disk' | 'unknown';

const KNOWN_CACHE_TYPES: readonly CacheType[] = [
  'redis',
  'redis-semantic',
  'local',
  's3',
  'qdrant-semantic',
  'disk',
] as const;

/** The raw shape /cache/ping returns (fields vary by version — all optional, degrades never-throws). */
export interface RawCachePing {
  status?: string | null;
  cache_type?: string | null;
  /** Some versions echo the ping-through health of the underlying store. */
  ping_response?: boolean | null;
  /** Whether LiteLLM could set+get a probe key (a deeper liveness check on some versions). */
  set_cache_response?: string | null;
  /** Echoed cache policy (read-only — set at deploy). Names mirror litellm_settings.cache. */
  litellm_cache_params?: {
    supported_call_types?: string[] | null;
    ttl?: number | null;
    mode?: string | null;
    type?: string | null;
    namespace?: string | null;
  } | null;
  [k: string]: unknown;
}

/** Read-only cache policy — surfaced so operators SEE the config without pretending it's settable. */
export interface CachePolicy {
  ttlSeconds: number | null;
  supportedCallTypes: string[];
  mode: string | null;
  namespace: string | null;
}

/** The terminal, safe cache-status shape the UI + routes consume. */
export interface CacheStatus {
  /** OFFGRID_LITELLM_URL is set — the console CAN talk to a proxy. */
  configured: boolean;
  /** The proxy answered /cache/ping (regardless of whether a cache is wired). */
  reachable: boolean;
  /** A response cache is actually wired in the proxy config (ping reported a type + healthy). */
  cacheEnabled: boolean;
  /** Underlying store is healthy (ping_response / status:healthy). */
  healthy: boolean;
  type: CacheType;
  /** Read-only policy echoed by the proxy (configured at deploy; reload required to change). */
  policy: CachePolicy;
  /** Present when the proxy could not be reached / errored. */
  error?: string;
}

const EMPTY_POLICY: CachePolicy = {
  ttlSeconds: null,
  supportedCallTypes: [],
  mode: null,
  namespace: null,
};

/** Coerce an arbitrary cache-type string to the known union; unknown/empty ⇒ 'unknown'. PURE. */
export function normalizeCacheType(raw: unknown): CacheType {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (KNOWN_CACHE_TYPES as readonly string[]).includes(t) ? (t as CacheType) : 'unknown';
}

/** Non-negative finite integer, else null. PURE. */
function posIntOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** Extract the read-only policy from a ping's echoed params. PURE. */
export function normalizeCachePolicy(raw: RawCachePing | null | undefined): CachePolicy {
  const p = raw?.litellm_cache_params ?? null;
  if (!p) return { ...EMPTY_POLICY };
  const types = Array.isArray(p.supported_call_types)
    ? p.supported_call_types.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : [];
  const mode = typeof p.mode === 'string' && p.mode.trim() ? p.mode.trim() : null;
  const namespace = typeof p.namespace === 'string' && p.namespace.trim() ? p.namespace.trim() : null;
  return { ttlSeconds: posIntOrNull(p.ttl), supportedCallTypes: types, mode, namespace };
}

/**
 * Interpret a successful /cache/ping into the terminal CacheStatus. A cache is treated as ENABLED
 * only when the ping reports a recognized type AND a healthy signal — a proxy with caching off may
 * still answer the endpoint, and we must NOT paint that as "enabled". `healthy` is true when the
 * proxy reports status:'healthy' OR ping_response:true. PURE.
 */
export function interpretCachePing(raw: RawCachePing | null | undefined): CacheStatus {
  const type = normalizeCacheType(raw?.cache_type);
  const statusStr = typeof raw?.status === 'string' ? raw.status.trim().toLowerCase() : '';
  const healthy = statusStr === 'healthy' || raw?.ping_response === true;
  // A cache is "on" when the proxy names a real backend. Unknown type ⇒ endpoint answered but no
  // cache is actually wired (or an unrecognized backend) ⇒ report enabled:false honestly.
  const cacheEnabled = type !== 'unknown';
  return {
    configured: true,
    reachable: true,
    cacheEnabled,
    healthy: cacheEnabled && healthy,
    type,
    policy: normalizeCachePolicy(raw),
  };
}

/** Status when OFFGRID_LITELLM_URL is unset — the console can't reach any proxy. PURE. */
export function cacheStatusUnconfigured(): CacheStatus {
  return {
    configured: false,
    reachable: false,
    cacheEnabled: false,
    healthy: false,
    type: 'unknown',
    policy: { ...EMPTY_POLICY },
  };
}

/** Status when the proxy is configured but /cache/ping failed (unreachable / cache off / error). PURE. */
export function cacheStatusUnreachable(error: string): CacheStatus {
  return {
    configured: true,
    reachable: false,
    cacheEnabled: false,
    healthy: false,
    type: 'unknown',
    policy: { ...EMPTY_POLICY },
    error,
  };
}

// ─── flush request shaping ──────────────────────────────────────────────────────────────────────

/** What the flush route accepts: either 'all' (flushall) or specific keys (delete). */
export interface FlushInput {
  mode?: unknown;
  keys?: unknown;
}

export type FlushPlan =
  | { ok: true; kind: 'all' }
  | { ok: true; kind: 'keys'; keys: string[]; body: { keys: string[] } }
  | { ok: false; error: string };

/**
 * Validate + shape a flush request into the plan the adapter executes. 'all' ⇒ POST /cache/flushall
 * (no body). 'keys' ⇒ POST /cache/delete with a de-duped, trimmed, non-empty key list. Rejects an
 * empty/garbage key list rather than silently flushing everything. PURE.
 */
export function planFlush(input: FlushInput): FlushPlan {
  const mode = typeof input.mode === 'string' ? input.mode.trim().toLowerCase() : '';
  if (mode === 'all') return { ok: true, kind: 'all' };
  if (mode === 'keys') {
    if (!Array.isArray(input.keys)) return { ok: false, error: 'keys must be an array' };
    const keys = [
      ...new Set(
        input.keys
          .filter((k): k is string => typeof k === 'string')
          .map((k) => k.trim())
          .filter((k) => k !== ''),
      ),
    ];
    if (keys.length === 0) return { ok: false, error: 'keys must contain at least one non-empty key' };
    return { ok: true, kind: 'keys', keys, body: { keys } };
  }
  return { ok: false, error: "mode must be 'all' or 'keys'" };
}

/** A resource label for the audit trail describing what a flush plan affects. PURE. */
export function flushAuditResource(plan: Extract<FlushPlan, { ok: true }>): string {
  return plan.kind === 'all' ? 'cache:all' : `cache:keys(${plan.keys.length})`;
}

// ─── cache-hit observability (derived from /spend/logs rows) ──────────────────────────────────────

/** The subset of a /spend/logs row this module reads for hit-rate math (all optional). */
export interface RawCacheLog {
  /** LiteLLM stamps this WHEN response-caching is active. May be boolean, or "True"/"False"/"None". */
  cache_hit?: boolean | string | null;
  spend?: number | null;
  total_tokens?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  [k: string]: unknown;
}

/** Tri-state read of the cache_hit marker: a real hit, a real miss, or "not reported". PURE. */
export type CacheHitMark = 'hit' | 'miss' | 'unknown';

/**
 * Interpret LiteLLM's cache_hit marker. It is emitted as a bool on some versions and a string
 * ("True"/"False"/"None"/"") on others. Anything not clearly true/false ⇒ 'unknown' (NOT a miss) so
 * a deployment that never stamps it doesn't get a fabricated 100%-miss rate. PURE.
 */
export function readCacheHit(v: unknown): CacheHitMark {
  if (v === true) return 'hit';
  if (v === false) return 'miss';
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true' || t === '1' || t === 'yes') return 'hit';
    if (t === 'false' || t === '0' || t === 'no') return 'miss';
  }
  return 'unknown';
}

/** Non-negative finite number, else 0. PURE. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function totalTokensOf(row: RawCacheLog): number {
  return num(row.total_tokens) || num(row.prompt_tokens) + num(row.completion_tokens);
}

/** The terminal cache-observability shape the stats route returns. */
export interface CacheStats {
  /** Total rows read in the window. */
  requests: number;
  /** Rows where cache_hit was a real true/false — the denominator for an HONEST hit-rate. */
  decided: number;
  hits: number;
  misses: number;
  /** hits / decided, 0..1 — only meaningful when decided > 0. */
  hitRate: number;
  /** Tokens served from cache (summed over hit rows) — the compute avoided. */
  tokensSaved: number;
  /** $ saved (summed spend over hit rows) — $0 on free on-prem models, honest. */
  costSaved: number;
  /**
   * True when NO row carried a decidable cache_hit marker — the deployment doesn't report it, so the
   * UI must say so instead of showing 0% or 100%. (requests may still be > 0.)
   */
  markerUnavailable: boolean;
}

/**
 * Compute cache hit-rate + savings from normalized /spend/logs rows. Only rows with a decidable
 * cache_hit marker count toward hits/misses/hitRate; tokens/cost "saved" sum over the HIT rows only.
 * When nothing is decidable, `markerUnavailable` is true and hitRate is 0 (the UI reads the flag, not
 * the rate). PURE.
 */
export function computeCacheStats(rows: readonly RawCacheLog[]): CacheStats {
  let hits = 0;
  let misses = 0;
  let tokensSaved = 0;
  let costSaved = 0;
  for (const row of rows) {
    const mark = readCacheHit(row.cache_hit);
    if (mark === 'hit') {
      hits += 1;
      tokensSaved += totalTokensOf(row);
      costSaved += num(row.spend);
    } else if (mark === 'miss') {
      misses += 1;
    }
  }
  const decided = hits + misses;
  return {
    requests: rows.length,
    decided,
    hits,
    misses,
    hitRate: decided > 0 ? hits / decided : 0,
    tokensSaved,
    costSaved: Number(costSaved.toFixed(4)),
    markerUnavailable: decided === 0,
  };
}

/** Filter raw JSON to the cache-log rows (objects only), never throwing on a non-array. PURE. */
export function normalizeCacheLogs(raw: unknown): RawCacheLog[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is RawCacheLog => typeof r === 'object' && r !== null);
}
