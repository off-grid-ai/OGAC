// ─── PURE LiteLLM SPEND / FinOps logic — ZERO I/O, exhaustively unit-testable ─────────────────────
//
// LiteLLM (the DB-backed proxy) tracks per-request spend in its own store and exposes it over
// /spend/logs (+ aggregate rollups). This module is the zero-import decision layer for the console's
// FinOps surface: parse the operator's time window into API date bounds + display buckets, normalize
// LiteLLM's per-request spend rows into a safe typed shape, and roll those rows up BY MODEL, BY
// VIRTUAL-KEY, and INTO A TIME SERIES with honest summary math.
//
// HONESTY (required): the on-prem/free models the fleet serves compute $0 spend per call. So the
// PRIMARY signal here is TOKENS + REQUEST VOLUME, not dollars. `summarize` reports `allFree` when
// every row cost $0 so the UI can label dollar-spend as a $0 no-op instead of implying budgets bite.
//
// The I/O (calling LiteLLM, resolving the base URL/key) lives in adapters/litellm-spend.ts. This
// file NEVER fetches — it is fed raw JSON and returns terminal, asserted shapes.

// ─── time window ──────────────────────────────────────────────────────────────────────────────

/** The operator-selectable spend windows (URL `?range=`). */
export type SpendRange = '24h' | '7d' | '30d';

/** How rows are grouped for the by-* breakdown (URL `?groupBy=`). */
export type SpendGroupBy = 'model' | 'key';

export const SPEND_RANGES: readonly SpendRange[] = ['24h', '7d', '30d'] as const;
export const SPEND_GROUP_BYS: readonly SpendGroupBy[] = ['model', 'key'] as const;

/** Coerce arbitrary input to a valid range; unknown ⇒ the '24h' default. PURE. */
export function parseRange(raw: unknown): SpendRange {
  return SPEND_RANGES.includes(raw as SpendRange) ? (raw as SpendRange) : '24h';
}

/** Coerce arbitrary input to a valid groupBy; unknown ⇒ the 'model' default. PURE. */
export function parseGroupBy(raw: unknown): SpendGroupBy {
  return SPEND_GROUP_BYS.includes(raw as SpendGroupBy) ? (raw as SpendGroupBy) : 'model';
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export interface SpendWindow {
  range: SpendRange;
  /** Inclusive window start (ms epoch). */
  startMs: number;
  /** Window end (ms epoch) — `now`. */
  endMs: number;
  /** `YYYY-MM-DD` (UTC) bounds for LiteLLM's start_date/end_date query params. */
  startDate: string;
  endDate: string;
  /** Width of one display bucket (ms): hourly for 24h, daily for 7d/30d. */
  bucketMs: number;
  /** Number of display buckets across the window. */
  bucketCount: number;
}

/** `YYYY-MM-DD` (UTC) for an epoch — LiteLLM date params are day-granular. PURE. */
export function toDateStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Resolve a range into concrete window bounds + display bucketing. 24h ⇒ 24 hourly buckets; 7d ⇒ 7
 * daily; 30d ⇒ 30 daily. `now` is injectable so tests are deterministic. PURE.
 */
export function parseWindow(range: SpendRange, now: number = Date.now()): SpendWindow {
  const spec: Record<SpendRange, { spanMs: number; bucketMs: number }> = {
    '24h': { spanMs: 24 * MS_PER_HOUR, bucketMs: MS_PER_HOUR },
    '7d': { spanMs: 7 * MS_PER_DAY, bucketMs: MS_PER_DAY },
    '30d': { spanMs: 30 * MS_PER_DAY, bucketMs: MS_PER_DAY },
  };
  const { spanMs, bucketMs } = spec[range];
  const startMs = now - spanMs;
  return {
    range,
    startMs,
    endMs: now,
    startDate: toDateStamp(startMs),
    endDate: toDateStamp(now),
    bucketMs,
    bucketCount: Math.round(spanMs / bucketMs),
  };
}

// ─── row normalization ──────────────────────────────────────────────────────────────────────────

/** The subset of a LiteLLM /spend/logs row the console maps (all optional → degrades, never throws). */
export interface RawSpendLog {
  request_id?: string | null;
  api_key?: string | null;
  model?: string | null;
  /** $ cost LiteLLM computed (0 for free/local models). */
  spend?: number | null;
  total_tokens?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  /** ISO string or ms epoch. */
  startTime?: string | number | null;
  endTime?: string | number | null;
  /** End-user attribution (LiteLLM `user` / `end_user`). */
  user?: string | null;
  end_user?: string | null;
  call_type?: string | null;
  metadata?: {
    user_api_key_alias?: string | null;
    user_api_key?: string | null;
  } | null;
}

/** A normalized per-request spend row — the terminal shape the drill-down list + rollups consume. */
export interface SpendLogRow {
  requestId: string | null;
  /** Masked key token (last 4 only) — the raw hashed key is NEVER surfaced. */
  keyMasked: string | null;
  keyAlias: string | null;
  model: string;
  spend: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  /** Request time (ms epoch), or null when unparseable. */
  ts: number | null;
  endUser: string | null;
}

/** Non-negative finite number, else 0. PURE. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Parse LiteLLM's timestamp — it emits ISO strings on /spend/logs but ms epochs elsewhere. Returns
 * ms epoch, or null when unparseable. PURE.
 */
export function parseSpendTime(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const trimmed = v.trim();
  const asNum = Number(trimmed);
  if (trimmed !== '' && Number.isFinite(asNum) && String(asNum) === trimmed) {
    return asNum > 0 ? asNum : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Mask a key/token to `…last4`; short/empty tokens degrade to null. PURE. */
export function maskToken(token: string | null | undefined): string | null {
  const t = (token ?? '').trim();
  if (!t) return null;
  return t.length <= 4 ? `…${t}` : `…${t.slice(-4)}`;
}

/** Normalize ONE raw /spend/logs row → the safe SpendLogRow. PURE. */
export function normalizeSpendLog(raw: RawSpendLog): SpendLogRow {
  const meta = raw.metadata ?? {};
  const total = num(raw.total_tokens) || num(raw.prompt_tokens) + num(raw.completion_tokens);
  return {
    requestId: (raw.request_id ?? '').trim() || null,
    keyMasked: maskToken(raw.api_key ?? meta.user_api_key ?? null),
    keyAlias: (meta.user_api_key_alias ?? '').trim() || null,
    model: (raw.model ?? '').trim() || 'unknown',
    spend: num(raw.spend),
    tokens: total,
    promptTokens: num(raw.prompt_tokens),
    completionTokens: num(raw.completion_tokens),
    ts: parseSpendTime(raw.startTime ?? raw.endTime),
    endUser: (raw.end_user ?? raw.user ?? '').trim() || null,
  };
}

/** Normalize an array of raw rows, dropping anything that isn't an object. PURE. */
export function normalizeSpendLogs(raw: unknown): SpendLogRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is RawSpendLog => typeof r === 'object' && r !== null)
    .map(normalizeSpendLog);
}

// ─── rollups ──────────────────────────────────────────────────────────────────────────────────

export interface SpendBucketBase {
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  spend: number;
}

export interface ModelSpend extends SpendBucketBase {
  model: string;
}

export interface KeySpend extends SpendBucketBase {
  /** The alias when known, else the masked token, else '(unattributed)'. */
  key: string;
  keyAlias: string | null;
  keyMasked: string | null;
}

export interface TimeBucket extends SpendBucketBase {
  /** Bucket start (ms epoch). */
  bucketStart: number;
}

function addInto(target: SpendBucketBase, row: SpendLogRow): void {
  target.requests += 1;
  target.tokens += row.tokens;
  target.promptTokens += row.promptTokens;
  target.completionTokens += row.completionTokens;
  target.spend += row.spend;
}

function emptyBucket(): SpendBucketBase {
  return { requests: 0, tokens: 0, promptTokens: 0, completionTokens: 0, spend: 0 };
}

/**
 * Roll rows up by model. Sorted by SPEND desc, then TOKENS desc (tokens break ties on free models
 * where every spend is 0 — the honest primary signal). PURE.
 */
export function aggregateByModel(rows: readonly SpendLogRow[]): ModelSpend[] {
  const byModel = new Map<string, ModelSpend>();
  for (const row of rows) {
    let entry = byModel.get(row.model);
    if (!entry) {
      entry = { model: row.model, ...emptyBucket() };
      byModel.set(row.model, entry);
    }
    addInto(entry, row);
  }
  return [...byModel.values()].sort((a, b) => b.spend - a.spend || b.tokens - a.tokens);
}

/**
 * Roll rows up by virtual key (alias-first identity; falls back to the masked token, then
 * '(unattributed)'). Sorted by SPEND desc, then TOKENS desc. PURE.
 */
export function aggregateByKey(rows: readonly SpendLogRow[]): KeySpend[] {
  const byKey = new Map<string, KeySpend>();
  for (const row of rows) {
    const identity = row.keyAlias ?? row.keyMasked ?? '(unattributed)';
    let entry = byKey.get(identity);
    if (!entry) {
      entry = {
        key: identity,
        keyAlias: row.keyAlias,
        keyMasked: row.keyMasked,
        ...emptyBucket(),
      };
      byKey.set(identity, entry);
    }
    addInto(entry, row);
  }
  return [...byKey.values()].sort((a, b) => b.spend - a.spend || b.tokens - a.tokens);
}

/**
 * Bucket rows into a fixed-length, chronologically-ordered time series across the window — every
 * bucket is present (zero-filled) so the UI renders a continuous axis. Rows outside the window or
 * without a timestamp are dropped. PURE.
 */
export function aggregateTimeSeries(
  rows: readonly SpendLogRow[],
  window: SpendWindow,
): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  for (let i = 0; i < window.bucketCount; i += 1) {
    buckets.push({ bucketStart: window.startMs + i * window.bucketMs, ...emptyBucket() });
  }
  for (const row of rows) {
    if (row.ts === null || row.ts < window.startMs || row.ts > window.endMs) continue;
    const idx = Math.min(
      buckets.length - 1,
      Math.floor((row.ts - window.startMs) / window.bucketMs),
    );
    if (idx >= 0) addInto(buckets[idx], row);
  }
  return buckets;
}

// ─── summary ────────────────────────────────────────────────────────────────────────────────────

export interface SpendSummary {
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  spend: number;
  avgTokensPerRequest: number;
  avgCostPerRequest: number;
  /**
   * True when there is traffic but every request cost $0 — the free/on-prem reality. The UI uses
   * this to label dollar-spend as a $0 no-op and lead with tokens/volume instead.
   */
  allFree: boolean;
}

/** Totals + averages over the rows — the top-of-page summary band. PURE. */
export function summarize(rows: readonly SpendLogRow[]): SpendSummary {
  const base = emptyBucket();
  for (const row of rows) addInto(base, row);
  const { requests, tokens, promptTokens, completionTokens, spend } = base;
  return {
    requests,
    tokens,
    promptTokens,
    completionTokens,
    spend,
    avgTokensPerRequest: requests > 0 ? tokens / requests : 0,
    avgCostPerRequest: requests > 0 ? spend / requests : 0,
    // Honest: only "all free" when there IS traffic and it all cost nothing (no traffic ⇒ false).
    allFree: requests > 0 && spend === 0,
  };
}

// ─── the assembled FinOps view (what the summary route returns) ───────────────────────────────────

/** A LiteLLM aggregate endpoint that may not exist on the deployed version. */
export interface AggregateAvailability {
  available: boolean;
  /** Why it is unavailable (404/unreachable), for honest UI messaging. */
  reason?: string;
}

export interface SpendFinOpsView {
  configured: boolean;
  /** The proxy answered (spend logs were readable). */
  live: boolean;
  window: SpendWindow;
  summary: SpendSummary;
  byModel: ModelSpend[];
  byKey: KeySpend[];
  timeSeries: TimeBucket[];
  /** Which optional LiteLLM aggregate rollups were reachable (honest capability signal). */
  aggregates: {
    globalSpendKeys: AggregateAvailability;
    globalSpendModels: AggregateAvailability;
  };
  error?: string;
}

const UNPROBED: AggregateAvailability = { available: false, reason: 'not probed' };

/** Assemble the complete FinOps view from normalized rows + a window. PURE. */
export function assembleSpendView(
  rows: readonly SpendLogRow[],
  window: SpendWindow,
  opts: {
    configured: boolean;
    live: boolean;
    aggregates?: SpendFinOpsView['aggregates'];
    error?: string;
  },
): SpendFinOpsView {
  return {
    configured: opts.configured,
    live: opts.live,
    window,
    summary: summarize(rows),
    byModel: aggregateByModel(rows),
    byKey: aggregateByKey(rows),
    timeSeries: aggregateTimeSeries(rows, window),
    aggregates: opts.aggregates ?? {
      globalSpendKeys: UNPROBED,
      globalSpendModels: UNPROBED,
    },
    ...(opts.error ? { error: opts.error } : {}),
  };
}
