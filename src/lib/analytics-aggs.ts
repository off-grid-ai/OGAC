// PURE analytics-aggregation logic — zero I/O, unit-testable. Owns:
//   1. buildAggsQuery()   — the `size:0` `_search` body (terms / date_histogram / percentiles /
//                           value_count / sum, plus recent-vs-baseline filters for drift & perf).
//   2. parseAggsResponse() — turns the OpenSearch aggregation response into the SAME `Analytics`
//                           shape the page/routes/reports already consume, byte-identical in fields.
//   3. assembleAnalytics() — the SAME `Analytics` shape computed IN JS from already-fetched raw docs
//                           (mirrors finops.ts `assembleFinOps`). This is the source-of-truth path
//                           computeAnalytics uses: it string-buckets the day series off the `ts`
//                           field EXACTLY as FinOps' `daily` does, so the per-day charts (`series`)
//                           bind to the SAME populated docs that feed the stat cards — regardless of
//                           whether the OpenSearch `@timestamp` field is mapped as a `date`. A
//                           `date_histogram` on an un-mapped/mis-mapped `@timestamp` returns ZERO
//                           buckets, which flattened the Events/Latency charts while the scalar sums
//                           feeding the cards still populated — the #238 "cards have data, charts are
//                           flat" bug. Assembling in JS removes that fragility (the terminal artifact
//                           the charts render is a real series whenever the cards are non-empty).
// No `fetch`, no `process.env` here — the thin adapter in analytics.ts wires those in.
import type { Analytics, DayPoint, ModelStat } from '@/lib/analytics-types';

// The subset of a gateway traffic record the JS rollup reads. Structurally a `store.AuditEvent`
// (what `gatewayEvents()` returns) but declared locally so this pure module never imports the heavy,
// I/O-laden `@/lib/store` graph — keeping it zero-IO and unit-testable. `ts` is the record time
// (ISO string, as `gatewayEvents` maps it); `latencyMs` is optional (missing → 0).
export interface AnalyticsEvent {
  ts: string;
  model: string;
  tokens: number;
  latencyMs?: number;
  outcome: 'ok' | 'blocked' | 'redacted';
}

const DRIFT_FACTOR = 1.5;
const PERF_FACTOR = 1.3;
export const RECENT_MS = 2 * 86_400_000;

// A record is "blocked" when its HTTP status is >= 400, "ok" otherwise — the exact mapping the old
// per-doc loop applied (status>=400 → 'blocked', else 'ok'; 'redacted' never occurs from the gateway
// stream, so it stays 0, unchanged). We express that as a range filter on `status`.
const BLOCKED_FILTER = { range: { status: { gte: 400 } } };

// Latency percentiles must round to whole ms (the old percentile() did Math.round). OpenSearch
// returns floats, so we round in the parser.
function roundPct(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// Avg latency for a bucket: Math.round(sum_ms / count) — identical to the old byModel/series maths.
// count === 0 → 0 (avoids NaN); the old loops never produced empty buckets either.
function avgLatency(sumMs: number, count: number): number {
  return count > 0 ? Math.round(sumMs / count) : 0;
}

const LATENCY_PCT = { percentiles: { field: 'ms', percents: [50, 95] } };

/**
 * TENANT ISOLATION (G-ADV-OBS-ORG): build the OpenSearch `bool.filter` array that scopes an
 * analytics query to one org (+ an optional pipeline). Every analytics/logs query MUST carry the org
 * term or a tenant sees combined cross-tenant traffic/cost. Pure + exported so the raw-doc reader,
 * the aggregation builder, and the gateway logs/analytics routes all scope IDENTICALLY (DRY). An
 * empty/absent org means "no org scoping" (single-tenant / the default org that isn't stamped),
 * matching how other org-scoped surfaces treat the default org.
 */
export function analyticsScopeFilters(
  org?: string | null,
  pipelineTag?: string | null,
): Record<string, unknown>[] {
  const filters: Record<string, unknown>[] = [];
  if (org) filters.push({ term: { org } });
  if (pipelineTag) filters.push({ term: { 'project.keyword': pipelineTag } });
  return filters;
}

// Turn a filter array into a query clause: a bool/filter when there's anything to scope on, else
// match_all. Shared so the raw-doc reader and the aggregation builder agree.
export function scopedQuery(filters: Record<string, unknown>[]): Record<string, unknown> {
  return filters.length ? { bool: { filter: filters } } : { match_all: {} };
}

/**
 * The single `size:0` aggregation query that replaces fetching raw docs.
 * `nowMs` is injected (not read from Date.now here) so the builder stays pure and testable.
 * `org` scopes the whole rollup to the caller's tenant (G-ADV-OBS-ORG) via an `org` term filter.
 * An optional `pipelineTag` (`pipeline:<id>`) narrows the rollup to one pipeline's slice — the
 * gateway docs carry the pipeline attribution in `project` (PA-12), so we filter on `project.keyword`.
 */
export function buildAggsQuery(
  nowMs: number,
  pipelineTag?: string | null,
  org?: string | null,
): Record<string, unknown> {
  const recentGteIso = new Date(nowMs - RECENT_MS).toISOString();
  return {
    size: 0,
    query: scopedQuery(analyticsScopeFilters(org, pipelineTag)),
    aggs: {
      total_tokens: { sum: { field: 'tokens' } },
      latency_pct: LATENCY_PCT,
      // Outcomes: total = hits.total; blocked = this filter; ok = total - blocked; redacted = 0.
      blocked: { filter: BLOCKED_FILTER },
      // byModel — one bucket per model, tokens desc (parser re-sorts to guarantee identical order).
      by_model: {
        // `model.keyword` (the aggregatable sub-field), NOT the bare `text` field `model` — a terms
        // agg on the text field 400s the whole size:0 search, which zeroed the entire analytics page
        // (accounting worked because it uses `.keyword`). (C2 fix)
        terms: { field: 'model.keyword', size: 1000, order: { tokens: 'desc' } },
        aggs: {
          tokens: { sum: { field: 'tokens' } },
          latency: { sum: { field: 'ms' } },
        },
      },
      // Time series — one bucket per calendar day (UTC), matching the old ts.slice(0,10).
      series: {
        date_histogram: {
          field: '@timestamp',
          calendar_interval: 'day',
          format: 'yyyy-MM-dd',
          time_zone: 'UTC',
          min_doc_count: 1,
        },
        aggs: { latency: { sum: { field: 'ms' } } },
      },
      // Drift & perf split the stream into recent (< 2 days old) and baseline (>= 2 days old),
      // mirroring the old filter() boundary exactly (recent uses `gte recentGte`, baseline `lt`).
      recent: {
        filter: { range: { '@timestamp': { gte: recentGteIso } } },
        aggs: { blocked: { filter: BLOCKED_FILTER }, latency_pct: LATENCY_PCT },
      },
      baseline: {
        filter: { range: { '@timestamp': { lt: recentGteIso } } },
        aggs: { blocked: { filter: BLOCKED_FILTER }, latency_pct: LATENCY_PCT },
      },
    },
  };
}

// Blocked/redacted rate for a window: flagged / total, to 3 decimals (matches old blockedRate).
// redacted is always 0 from this stream, so flagged === blocked.
function rate(blocked: number, total: number): number {
  if (total === 0) return 0;
  return Number((blocked / total).toFixed(3));
}

interface OsBucket {
  key?: unknown;
  key_as_string?: string;
  doc_count?: number;
  tokens?: { value?: number };
  latency?: { value?: number };
}

interface OsWindow {
  doc_count?: number;
  blocked?: { doc_count?: number };
  latency_pct?: { values?: Record<string, number> };
}

interface OsAggs {
  total_tokens?: { value?: number };
  latency_pct?: { values?: Record<string, number> };
  blocked?: { doc_count?: number };
  by_model?: { buckets?: OsBucket[] };
  series?: { buckets?: OsBucket[] };
  recent?: OsWindow;
  baseline?: OsWindow;
}

interface OsResponse {
  hits?: { total?: { value?: number } | number };
  aggregations?: OsAggs;
}

function totalHits(resp: OsResponse): number {
  const t = resp.hits?.total;
  if (typeof t === 'number') return t;
  return Number(t?.value ?? 0);
}

function pct(values: Record<string, number> | undefined, p: '50.0' | '95.0'): number {
  return roundPct(values?.[p]);
}

/**
 * Parse an OpenSearch aggregation response into the `Analytics` shape. Pure — no I/O.
 * Produces the exact same fields/types as the old JS rollups.
 */
export function parseAggsResponse(resp: OsResponse): Analytics {
  const aggs = resp.aggregations ?? {};
  const totalEvents = totalHits(resp);
  const totalTokens = Math.round(Number(aggs.total_tokens?.value ?? 0));

  const p50 = pct(aggs.latency_pct?.values, '50.0');
  const p95 = pct(aggs.latency_pct?.values, '95.0');

  const blocked = Number(aggs.blocked?.doc_count ?? 0);
  const ok = totalEvents - blocked;

  const byModel: ModelStat[] = (aggs.by_model?.buckets ?? [])
    .map((b) => {
      const events = Number(b.doc_count ?? 0);
      return {
        model: String(b.key ?? 'unknown'),
        events,
        tokens: Math.round(Number(b.tokens?.value ?? 0)),
        avgLatency: avgLatency(Number(b.latency?.value ?? 0), events),
      };
    })
    // The terms agg already orders by tokens desc, but re-sort to guarantee identical ordering.
    .sort((a, b) => b.tokens - a.tokens);

  const series: DayPoint[] = (aggs.series?.buckets ?? [])
    .map((b) => {
      const events = Number(b.doc_count ?? 0);
      return {
        day: String(b.key_as_string ?? ''),
        events,
        avgLatency: avgLatency(Number(b.latency?.value ?? 0), events),
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day));

  const recentTotal = Number(aggs.recent?.doc_count ?? 0);
  const baseTotal = Number(aggs.baseline?.doc_count ?? 0);
  const recentBlocked = rate(Number(aggs.recent?.blocked?.doc_count ?? 0), recentTotal);
  const baseBlocked = rate(Number(aggs.baseline?.blocked?.doc_count ?? 0), baseTotal);
  const recentP95 = pct(aggs.recent?.latency_pct?.values, '95.0');
  const baseP95 = pct(aggs.baseline?.latency_pct?.values, '95.0');

  return {
    totalEvents,
    totalTokens,
    p50,
    p95,
    // Egress rate: leftDevice is always false for gateway records, so this was — and stays — 0.0.
    egressRate: 0,
    outcomes: { ok, redacted: 0, blocked },
    byModel,
    series,
    drift: {
      recent: recentBlocked,
      baseline: baseBlocked,
      flagged: recentBlocked > baseBlocked * DRIFT_FACTOR,
    },
    perf: { recent: recentP95, baseline: baseP95, flagged: recentP95 > baseP95 * PERF_FACTOR },
  };
}

// ─── JS assembly over already-fetched raw docs (mirrors finops.ts assembleFinOps) ───────────────
// A record's blocked-rate flag: blocked OR redacted (redacted never occurs from the gateway stream
// today, but include it so the rule matches the FinOps/old-loop definition exactly).
function isFlagged(e: AnalyticsEvent): boolean {
  return e.outcome === 'blocked' || e.outcome === 'redacted';
}

// Exact percentile of a set of latencies — matches the old JS-loop percentile() (ceil index, rounded).
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}

// Blocked-rate over a window: flagged / total, to 3 decimals (matches parseAggsResponse's `rate`).
function flaggedRate(events: AnalyticsEvent[]): number {
  return rate(events.filter(isFlagged).length, events.length);
}

/**
 * Compute the full `Analytics` rollup IN JS from already-fetched gateway docs — the SAME output shape
 * `parseAggsResponse` produces, but never dependent on the OpenSearch `@timestamp` date-mapping (the
 * source of the #238 flat-chart bug). Pure: `nowMs` is injected so the recent/baseline split is
 * deterministic. The day series buckets by `ts.slice(0,10)` — identical to finops.ts `daily` and the
 * original JS-loop `series()` — so the charts bind to the same docs the stat cards do.
 */
export function assembleAnalytics(events: AnalyticsEvent[], nowMs: number): Analytics {
  const totalEvents = events.length;
  const totalTokens = events.reduce((a, e) => a + e.tokens, 0);
  const lat = (e: AnalyticsEvent) => e.latencyMs ?? 0;
  const allLat = events.map(lat);

  // byModel — tokens desc, avgLatency = round(latencySum / events) (matches the old loop + parser).
  const modelMap = new Map<string, { events: number; tokens: number; latency: number }>();
  for (const e of events) {
    const m = modelMap.get(e.model) ?? { events: 0, tokens: 0, latency: 0 };
    m.events += 1;
    m.tokens += e.tokens;
    m.latency += lat(e);
    modelMap.set(e.model, m);
  }
  const byModel: ModelStat[] = [...modelMap.entries()]
    .map(([model, v]) => ({
      model,
      events: v.events,
      tokens: v.tokens,
      avgLatency: avgLatency(v.latency, v.events),
    }))
    .sort((a, b) => b.tokens - a.tokens);

  // series — one point per calendar day (UTC), keyed by the ISO date prefix (mapping-independent).
  const dayMap = new Map<string, { events: number; latency: number }>();
  for (const e of events) {
    const day = e.ts.slice(0, 10);
    const d = dayMap.get(day) ?? { events: 0, latency: 0 };
    d.events += 1;
    d.latency += lat(e);
    dayMap.set(day, d);
  }
  const series: DayPoint[] = [...dayMap.entries()]
    .map(([day, v]) => ({ day, events: v.events, avgLatency: avgLatency(v.latency, v.events) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // outcomes — redacted never occurs from the gateway stream (stays 0); ok = total - blocked.
  const blocked = events.filter((e) => e.outcome === 'blocked').length;
  const redacted = events.filter((e) => e.outcome === 'redacted').length;

  // drift & perf — split on the 2-day recent/baseline boundary (matches the old loop + query).
  const recentGte = nowMs - RECENT_MS;
  const recent = events.filter((e) => Date.parse(e.ts) >= recentGte);
  const baseline = events.filter((e) => Date.parse(e.ts) < recentGte);
  const recentBlocked = flaggedRate(recent);
  const baseBlocked = flaggedRate(baseline);
  const recentP95 = percentile(recent.map(lat), 0.95);
  const baseP95 = percentile(baseline.map(lat), 0.95);

  return {
    totalEvents,
    totalTokens,
    p50: percentile(allLat, 0.5),
    p95: percentile(allLat, 0.95),
    // Egress rate: gateway records never leftDevice — 0.0, unchanged from every prior implementation.
    egressRate: 0,
    outcomes: { ok: totalEvents - blocked, redacted, blocked },
    byModel,
    series,
    drift: {
      recent: recentBlocked,
      baseline: baseBlocked,
      flagged: recentBlocked > baseBlocked * DRIFT_FACTOR,
    },
    perf: { recent: recentP95, baseline: baseP95, flagged: recentP95 > baseP95 * PERF_FACTOR },
  };
}

// The real-zeros fallback when OpenSearch is unreachable — identical to computing over [] events.
export function emptyAnalytics(): Analytics {
  return {
    totalEvents: 0,
    totalTokens: 0,
    p50: 0,
    p95: 0,
    egressRate: 0,
    outcomes: { ok: 0, redacted: 0, blocked: 0 },
    byModel: [],
    series: [],
    drift: { recent: 0, baseline: 0, flagged: false },
    perf: { recent: 0, baseline: 0, flagged: false },
  };
}
