// PURE prompt-observability aggregation — zero I/O, unit-testable. Mirrors analytics-aggs.ts, but
// scoped to ONE library prompt's runs and rolled up BY VERSION.
//
// HOW A RUN IS TAGGED (the reuse seam): the Playground route sends an `x-offgrid-run` header on its
// gateway call. The gateway aggregator (scripts/gateway-aggregator.mjs) captures that header verbatim
// into the `corrId` field of the OpenSearch `offgrid-gateway` doc (the SAME field the chat run-id uses
// for cross-plane correlation). We encode the prompt tag as:
//
//     promptrun:<promptId>@<version>
//
// where <version> is the prompt's `updatedAt` ISO timestamp — the library keeps a single living
// version per prompt (each edit bumps updatedAt), so updatedAt IS the version identifier. Filtering
// gateway docs by `corrId.keyword` prefix `promptrun:<id>@` gives exactly that prompt's runs; the
// `@<version>` suffix lets us split them per version.
//
// This module owns the two pure halves:
//   1. buildPromptAggsQuery()  — the `size:0` `_search` body (prefix filter on corrId + terms/
//      percentiles/value_count/sum/date_histogram aggs, split by version).
//   2. parsePromptAggsResponse() — turns the OpenSearch aggregation response into PromptObservability.
// No fetch, no process.env here — the thin route wires those in.

const LATENCY_PCT = { percentiles: { field: 'ms', percents: [50, 95] } };
// A run is "blocked/failed" when its gateway HTTP status is >= 400 (same mapping analytics-aggs uses).
// NOTE: guardrail *injection* blocks happen in the console BEFORE the gateway call, so they never
// reach OpenSearch — this rate is honestly the gateway-level failure/refusal rate, surfaced as such.
const BLOCKED_FILTER = { range: { status: { gte: 400 } } };

/** The corrId tag a prompt run is stamped with. Pure — the single encoder both sides agree on. */
export function promptRunTag(promptId: string, version: string): string {
  return `promptrun:${promptId}@${version}`;
}

/** The corrId prefix that matches every run of a prompt across all its versions. */
export function promptRunPrefix(promptId: string): string {
  return `promptrun:${promptId}@`;
}

/** Extract the `<version>` out of a `promptrun:<id>@<version>` corrId key. '' if it doesn't match. */
export function versionFromTag(promptId: string, corrId: string): string {
  const prefix = promptRunPrefix(promptId);
  return corrId.startsWith(prefix) ? corrId.slice(prefix.length) : '';
}

/**
 * The single `size:0` aggregation query for one prompt's runs. `nowMs` is injected (not Date.now)
 * so the builder stays pure/testable. `days` bounds the daily series + overall window.
 */
export function buildPromptAggsQuery(
  promptId: string,
  nowMs: number,
  days = 30,
): Record<string, unknown> {
  const gteIso = new Date(nowMs - days * 86_400_000).toISOString();
  return {
    size: 0,
    query: {
      bool: {
        filter: [
          // corrId.keyword — the aggregatable sub-field (a terms/prefix agg on the bare text field
          // 400s the whole search, the same trap analytics-aggs documents with model.keyword).
          { prefix: { 'corrId.keyword': promptRunPrefix(promptId) } },
          { range: { '@timestamp': { gte: gteIso } } },
        ],
      },
    },
    aggs: {
      total_tokens: { sum: { field: 'tokens' } },
      latency_pct: LATENCY_PCT,
      blocked: { filter: BLOCKED_FILTER },
      // One bucket per version (corrId), so the panel can show per-version metrics.
      by_version: {
        terms: { field: 'corrId.keyword', size: 200, order: { _count: 'desc' } },
        aggs: {
          tokens: { sum: { field: 'tokens' } },
          latency_pct: LATENCY_PCT,
          blocked: { filter: BLOCKED_FILTER },
        },
      },
      // Daily run series (UTC calendar day), matching analytics-aggs' series shape.
      series: {
        date_histogram: {
          field: '@timestamp',
          calendar_interval: 'day',
          format: 'yyyy-MM-dd',
          time_zone: 'UTC',
          min_doc_count: 1,
        },
      },
    },
  };
}

function roundPct(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function pct(values: Record<string, number> | undefined, p: '50.0' | '95.0'): number {
  return roundPct(values?.[p]);
}

// Blocked/failed rate for a window: blocked / total, to 3 decimals (matches analytics-aggs.rate).
function rate(blocked: number, total: number): number {
  if (total === 0) return 0;
  return Number((blocked / total).toFixed(3));
}

export interface PromptVersionStat {
  /** The version identifier (the prompt's updatedAt ISO at run time). */
  version: string;
  runs: number;
  tokens: number;
  p50: number;
  p95: number;
  /** Gateway-level failure/block rate (status >= 400), 0..1. */
  blockRate: number;
}

export interface PromptDayPoint {
  day: string;
  runs: number;
}

export interface PromptObservability {
  /** Total runs of this prompt (all versions) in the window. */
  runs: number;
  tokens: number;
  p50: number;
  p95: number;
  blockRate: number;
  byVersion: PromptVersionStat[];
  series: PromptDayPoint[];
  /** The window (days) these metrics cover. */
  windowDays: number;
}

interface OsPctWindow {
  doc_count?: number;
  tokens?: { value?: number };
  latency_pct?: { values?: Record<string, number> };
  blocked?: { doc_count?: number };
  key?: unknown;
  key_as_string?: string;
}

interface OsResponse {
  hits?: { total?: { value?: number } | number };
  aggregations?: {
    total_tokens?: { value?: number };
    latency_pct?: { values?: Record<string, number> };
    blocked?: { doc_count?: number };
    by_version?: { buckets?: OsPctWindow[] };
    series?: { buckets?: OsPctWindow[] };
  };
}

function totalHits(resp: OsResponse): number {
  const t = resp.hits?.total;
  if (typeof t === 'number') return t;
  return Number(t?.value ?? 0);
}

/**
 * Parse an OpenSearch aggregation response into PromptObservability. Pure — no I/O. `promptId` is
 * used to strip the corrId prefix down to the bare version label.
 */
export function parsePromptAggsResponse(
  promptId: string,
  resp: OsResponse,
  windowDays = 30,
): PromptObservability {
  const aggs = resp.aggregations ?? {};
  const runs = totalHits(resp);
  const tokens = Math.round(Number(aggs.total_tokens?.value ?? 0));
  const p50 = pct(aggs.latency_pct?.values, '50.0');
  const p95 = pct(aggs.latency_pct?.values, '95.0');
  const blocked = Number(aggs.blocked?.doc_count ?? 0);

  const byVersion: PromptVersionStat[] = (aggs.by_version?.buckets ?? [])
    .map((b) => {
      const vRuns = Number(b.doc_count ?? 0);
      return {
        version: versionFromTag(promptId, String(b.key ?? '')),
        runs: vRuns,
        tokens: Math.round(Number(b.tokens?.value ?? 0)),
        p50: pct(b.latency_pct?.values, '50.0'),
        p95: pct(b.latency_pct?.values, '95.0'),
        blockRate: rate(Number(b.blocked?.doc_count ?? 0), vRuns),
      };
    })
    // Newest version first (ISO timestamps sort lexicographically); fall back to run count.
    .sort((a, b) => b.version.localeCompare(a.version) || b.runs - a.runs);

  const series: PromptDayPoint[] = (aggs.series?.buckets ?? [])
    .map((b) => ({ day: String(b.key_as_string ?? ''), runs: Number(b.doc_count ?? 0) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    runs,
    tokens,
    p50,
    p95,
    blockRate: rate(blocked, runs),
    byVersion,
    series,
    windowDays,
  };
}

/** Real zeros when there are no runs / OpenSearch is unreachable. */
export function emptyPromptObservability(windowDays = 30): PromptObservability {
  return {
    runs: 0,
    tokens: 0,
    p50: 0,
    p95: 0,
    blockRate: 0,
    byVersion: [],
    series: [],
    windowDays,
  };
}
