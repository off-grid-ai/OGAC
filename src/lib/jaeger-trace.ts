// Pure, ZERO-IO logic for the distributed-trace SEARCH surface (the third observability pillar next
// to logs and metrics). This layer owns every decision the trace UI depends on:
//   • search-param building     — time-range → microsecond start/end, min-duration + error-tag encoding
//   • trace normalization        — raw Jaeger trace → a compact, typed list row (with REAL error detection)
//   • span-waterfall enrichment  — geometry (offset/width/depth) reused from jaeger-shape, enriched with
//                                  per-span tags + error highlighting
//   • service / operation normalization
//   • client-side filters        — belt-and-braces min-duration + error-only (Jaeger's tag index may miss)
//
// The thin fetcher that calls Jaeger lives in `src/lib/adapters/jaeger.ts` (excluded from coverage).
// Every branch here is exercised by `test/jaeger-trace.test.ts`.
//
// DRY: the trace/span GEOMETRY (root-span detection, duration window, waterfall offset/width/depth) is
// NOT re-implemented — it is imported from `jaeger-shape.ts` and this module only adds the parts that
// module intentionally omits (error detection, span tags, search-param + range encoding, operations).
import {
  type JaegerServicesResponse,
  type JaegerSpan,
  type JaegerTrace,
  type JaegerTracesResponse,
  shapeServices,
  shapeTraceSpans,
  shapeTraceSummary,
} from './jaeger-shape';

// ── Tag-aware raw shapes ────────────────────────────────────────────────────────
// jaeger-shape's raw span omits `tags` (it never needed them); the search/detail surface does, so we
// extend the base rather than redefine it.
export interface JaegerTag {
  key?: string;
  type?: string;
  value?: unknown;
}
export interface TaggedSpan extends JaegerSpan {
  tags?: JaegerTag[] | null;
}
export interface TaggedTrace extends Omit<JaegerTrace, 'spans'> {
  spans?: TaggedSpan[] | null;
}
// Jaeger's operations endpoint returns either a list of strings (legacy
// `/api/services/{s}/operations`) or a list of `{name, spanKind}` objects (`/api/operations`).
export interface JaegerOperation {
  name?: string;
  spanKind?: string;
}
export interface JaegerOperationsResponse {
  data?: Array<string | JaegerOperation> | null;
}

// ── Time ranges ─────────────────────────────────────────────────────────────────
export const TRACE_RANGES = ['15m', '1h', '6h', '24h'] as const;
export type TraceRange = (typeof TRACE_RANGES)[number];
const RANGE_MINUTES: Record<TraceRange, number> = { '15m': 15, '1h': 60, '6h': 360, '24h': 1440 };
export const DEFAULT_RANGE: TraceRange = '1h';

// Pure: coerce an arbitrary string to a supported range (defaults to 1h).
export function parseRange(value: string | null | undefined): TraceRange {
  return (TRACE_RANGES as readonly string[]).includes(value ?? '')
    ? (value as TraceRange)
    : DEFAULT_RANGE;
}

// Pure: a range + "now" → the microsecond [start, end] window Jaeger expects.
export function rangeWindowMicros(
  range: TraceRange,
  nowMs: number,
): { startUs: number; endUs: number } {
  const endUs = Math.floor(nowMs * 1000);
  const startUs = Math.floor((nowMs - RANGE_MINUTES[range] * 60_000) * 1000);
  return { startUs, endUs };
}

// ── Search-param building ─────────────────────────────────────────────────────────
export interface TraceSearchInput {
  service: string;
  operation?: string | null;
  range?: string | null;
  minDurationMs?: number | null;
  errorOnly?: boolean;
  limit?: number | null;
  nowMs: number;
}

const clampLimit = (n: number | null | undefined): number => {
  if (!Number.isFinite(n ?? NaN)) return 20;
  return Math.min(Math.max(Math.floor(n as number), 1), 200);
};

// Pure: build the query string for Jaeger's `GET /api/traces`. `operation` is dropped when empty or
// the sentinel "all"; `minDuration` is encoded as Jaeger's duration syntax (`150ms`); `errorOnly`
// becomes the `tags` JSON `{"error":"true"}`.
export function buildTraceSearchParams(input: TraceSearchInput): URLSearchParams {
  const range = parseRange(input.range);
  const { startUs, endUs } = rangeWindowMicros(range, input.nowMs);
  const qs = new URLSearchParams();
  qs.set('service', input.service);
  const op = (input.operation ?? '').trim();
  if (op && op !== 'all') qs.set('operation', op);
  qs.set('start', String(startUs));
  qs.set('end', String(endUs));
  qs.set('limit', String(clampLimit(input.limit)));
  const min = input.minDurationMs ?? 0;
  if (Number.isFinite(min) && min > 0) qs.set('minDuration', `${Math.floor(min)}ms`);
  if (input.errorOnly) qs.set('tags', JSON.stringify({ error: 'true' }));
  return qs;
}

// ── Error detection ───────────────────────────────────────────────────────────────
// Pure: does a span carry an error signal? Recognizes the OTel/Jaeger conventions:
//   • error = true                     (bool or string)
//   • otel.status_code = ERROR         (string)
//   • http.status_code / http.response.status_code ≥ 500
function tagValueString(v: unknown): string {
  return typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : '';
}
export function spanHasError(span: TaggedSpan | null | undefined): boolean {
  const tags = span?.tags ?? [];
  for (const t of tags) {
    const key = (t.key ?? '').toLowerCase();
    const val = t.value;
    if (key === 'error' && (val === true || tagValueString(val).toLowerCase() === 'true')) {
      return true;
    }
    if (key === 'otel.status_code' && tagValueString(val).toUpperCase() === 'ERROR') return true;
    if (key === 'http.status_code' || key === 'http.response.status_code') {
      const code = Number(tagValueString(val));
      if (Number.isFinite(code) && code >= 500) return true;
    }
  }
  return false;
}

// Pure: any errored span → the trace is errored.
export function traceHasError(trace: TaggedTrace | null | undefined): boolean {
  return (trace?.spans ?? []).some((s) => spanHasError(s));
}

// ── Trace list rows ─────────────────────────────────────────────────────────────
export interface TraceListRow {
  traceId: string;
  rootOp: string;
  service: string;
  startTimeMs: number;
  durationMs: number;
  spanCount: number;
  hasError: boolean;
}

// Pure: raw trace → list row. Geometry (root op, service, duration window, span count, start) is
// reused verbatim from jaeger-shape.shapeTraceSummary; this only layers on REAL error detection
// (shapeTraceSummary hardcodes `errored:false` since the Platform-health tab never surfaced it).
export function normalizeTrace(trace: TaggedTrace): TraceListRow {
  const base = shapeTraceSummary(trace);
  return {
    traceId: base.traceId,
    rootOp: base.rootOperation,
    service: base.service,
    startTimeMs: base.startTimeMs,
    durationMs: base.durationMs,
    spanCount: base.spanCount,
    hasError: traceHasError(trace),
  };
}

// Pure: the `/api/traces` response → list rows, newest-first. Never throws.
export function normalizeTraces(res: JaegerTracesResponse | null | undefined): TraceListRow[] {
  const data = res?.data ?? [];
  if (!Array.isArray(data)) return [];
  return data
    .map((t) => normalizeTrace(t as TaggedTrace))
    .sort((a, b) => b.startTimeMs - a.startTimeMs);
}

// Pure: belt-and-braces client-side filters (Jaeger's error-tag index can miss, and we want the
// error-only toggle to be truthful). Applied after normalization.
export function applyTraceFilters(
  rows: TraceListRow[],
  opts: { errorOnly?: boolean; minDurationMs?: number | null },
): TraceListRow[] {
  const min = opts.minDurationMs ?? 0;
  return rows.filter(
    (r) => (!opts.errorOnly || r.hasError) && (!(min > 0) || r.durationMs >= min),
  );
}

// ── Span waterfall (detail) ───────────────────────────────────────────────────────
export interface WaterfallSpan {
  spanId: string;
  operation: string;
  service: string;
  offsetPct: number;
  widthPct: number;
  durationMs: number;
  depth: number;
  hasError: boolean;
  tags: Array<{ key: string; value: string }>;
}

// Pure: normalize a span's tags to displayable {key,value} pairs, sorted by key, empties dropped.
export function normalizeTags(
  tags: JaegerTag[] | null | undefined,
): Array<{ key: string; value: string }> {
  return (tags ?? [])
    .map((t) => ({ key: (t.key ?? '').trim(), value: tagValueString(t.value) }))
    .filter((t) => t.key.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}

// Pure: raw trace → enriched waterfall. Geometry (offset/width/depth, sort) is reused from
// jaeger-shape.shapeTraceSpans; this joins each geometry row back to its raw span (by spanID) to add
// per-span error highlighting + display tags.
export function buildWaterfall(trace: TaggedTrace | null | undefined): WaterfallSpan[] {
  const geometry = shapeTraceSpans(trace as JaegerTrace);
  const byId = new Map((trace?.spans ?? []).map((s) => [s.spanID ?? '', s]));
  return geometry.map((g) => {
    const raw = byId.get(g.spanId);
    return {
      spanId: g.spanId,
      operation: g.operation,
      service: g.service,
      offsetPct: g.offsetPct,
      widthPct: g.widthPct,
      durationMs: g.durationMs,
      depth: g.depth,
      hasError: spanHasError(raw),
      tags: normalizeTags(raw?.tags),
    };
  });
}

// Pure: a trace's headline for the detail view (root op, service, total duration, span count, error).
export interface TraceHeadline {
  traceId: string;
  rootOp: string;
  service: string;
  durationMs: number;
  spanCount: number;
  hasError: boolean;
}
export function traceHeadline(trace: TaggedTrace | null | undefined): TraceHeadline {
  const row = normalizeTrace((trace ?? {}) as TaggedTrace);
  return {
    traceId: row.traceId,
    rootOp: row.rootOp,
    service: row.service,
    durationMs: row.durationMs,
    spanCount: row.spanCount,
    hasError: row.hasError,
  };
}

// ── Service / operation pickers ─────────────────────────────────────────────────
// Pure: the service list — reused from jaeger-shape (sorted, de-duped, empties dropped).
export function normalizeServices(res: JaegerServicesResponse | null | undefined): string[] {
  return shapeServices(res);
}

// Pure: the operations list, tolerant of both response shapes (string[] and {name}[]). Sorted,
// de-duped, empties dropped.
export function normalizeOperations(
  res: JaegerOperationsResponse | null | undefined,
): string[] {
  const data = res?.data ?? [];
  if (!Array.isArray(data)) return [];
  const names = data
    .map((o) => (typeof o === 'string' ? o : (o?.name ?? '')))
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  return [...new Set(names)].sort();
}
