// ─── Per-entity AI-observability shaping — PURE, zero-I/O, exhaustively unit-testable ─────────────
//
// Governed AI calls emit traces + eval/quality scores to Langfuse (see src/lib/langfuse.ts read-back
// and src/lib/chat-trace.ts push). This module holds the PURE rules that turn that org-wide trace
// firehose into ONE entity's observability view — the pipeline / app / agent an operator is looking
// at. It NEVER touches the network: the impure fetch (Langfuse REST) lives in the adapter
// (src/lib/adapters/langfuse-entity.ts), which hands the raw rows to the pure functions here.
//
// Two honest ways a trace is attributed to an entity (no fabrication — a trace matches only when it
// really carries the entity's marker):
//   • TAG / SUBSTRING — pipeline runs are stamped with the canonical `pipeline:<id>` tag at the
//     source (chat-trace.ts), surfaced in the trace name / userId. We match those substrings.
//   • TRACE-ID MEMBERSHIP — a governed app/agent run's Langfuse trace id is the deterministic
//     `normalizeTraceId(runId)` (see src/lib/correlation.ts). So an app/agent's traces are exactly
//     the set of its runs' normalized ids. The adapter derives that set; we match on membership.
//
// Everything below is pure + deterministic and covered by test/observability-entity.test.ts.

import type { LangfuseObservation, LangfuseScore, LangfuseTrace } from './langfuse';
import { buildWaterfall, type ScoreTrendSeries, shapeScoreTrends, type WaterfallSpan } from './langfuse';

// ─── entity match descriptor ──────────────────────────────────────────────────────────────────────
// How to recognise THIS entity's traces. An entity supplies tag substrings, an explicit trace-id set,
// or both. With NEITHER selector it matches NOTHING (never the whole org firehose — honest scoping).
export interface EntityMatch {
  /** The entity id (pipeline/app/agent) — for display + as an implicit substring selector. */
  id: string;
  /** Substrings to look for in a trace's name/userId (e.g. `pipeline:pl_abc`). */
  tags?: string[];
  /** Exact Langfuse trace ids belonging to the entity (normalized run ids). */
  traceIds?: string[];
}

// Pure: does one trace belong to the entity? True when its id is in the trace-id set OR its
// name/userId contains any configured tag substring. An empty match (no selectors) → false.
export function traceMatchesEntity(trace: LangfuseTrace, match: EntityMatch): boolean {
  const idSet = new Set((match.traceIds ?? []).filter(Boolean));
  if (idSet.has(trace.id)) return true;
  const subs = (match.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (subs.length === 0) return false;
  // PRIMARY: the trace's Langfuse `tags[]` — stamped EXACTLY at emission (e.g. `pipeline:<id>`). This
  // is the canonical signal the write path (chat-trace/emitRunTrace) sets; match it exactly.
  const traceTags = Array.isArray(trace.tags) ? trace.tags : [];
  if (subs.some((s) => traceTags.includes(s))) return true;
  // FALLBACK (legacy best-effort): the tag as a substring of the trace name/userId.
  const hay = `${trace.name ?? ''} ${trace.userId ?? ''}`;
  return subs.some((s) => hay.includes(s));
}

// Pure: narrow the org-wide trace list to the entity's traces, newest-first preserved from input order.
export function filterTracesForEntity(
  traces: LangfuseTrace[],
  match: EntityMatch,
): LangfuseTrace[] {
  return traces.filter((t) => traceMatchesEntity(t, match));
}

// Pure: the scores that belong to the given set of trace ids. Used to scope the org-wide score list
// to just this entity's traces before building the quality trend.
export function filterScoresForTraces(
  scores: LangfuseScore[],
  traceIds: Iterable<string>,
): LangfuseScore[] {
  const set = new Set([...traceIds].filter(Boolean));
  return scores.filter((s) => (s.traceId ? set.has(s.traceId) : false));
}

// ─── latency statistics ─────────────────────────────────────────────────────────────────────────
// Nearest-rank percentile over a numeric sample. Empty sample → null (honest: no data, not zero).
export function percentile(values: number[], p: number): number | null {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const clamped = Math.min(Math.max(p, 0), 100);
  // Nearest-rank: rank = ceil(p/100 * N), 1-based, clamped into [1, N].
  const rank = Math.max(1, Math.ceil((clamped / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

export interface LatencyStats {
  count: number;
  p50: number | null;
  p95: number | null;
  avg: number | null;
  max: number | null;
}

// Pure: p50/p95/avg/max latency over the traces that carry a numeric latency. Traces with no latency
// are excluded from the sample (they don't count as zero — that would understate real latency).
export function latencyStats(traces: LangfuseTrace[]): LatencyStats {
  const nums = traces
    .map((t) => t.latency)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  if (nums.length === 0) return { count: 0, p50: null, p95: null, avg: null, max: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    count: nums.length,
    p50: percentile(nums, 50),
    p95: percentile(nums, 95),
    avg: round(sum / nums.length),
    max: Math.max(...nums),
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ─── per-trace quality ──────────────────────────────────────────────────────────────────────────
// Average of the numeric scores attached to one trace (a trace can carry several judge scores —
// faithfulness, toxicity, etc.). Non-numeric (categorical) scores are ignored. No scores → null.
export function traceQuality(scores: LangfuseScore[], traceId: string): number | null {
  const nums = scores
    .filter((s) => s.traceId === traceId && typeof s.value === 'number' && !Number.isNaN(s.value))
    .map((s) => s.value as number);
  if (nums.length === 0) return null;
  return round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// ─── trace row (list view) ────────────────────────────────────────────────────────────────────────
export interface TraceRow {
  id: string;
  name: string;
  userId: string | null;
  timestamp: string | null;
  latency: number | null;
  cost: number | null;
  spans: number | null;
  quality: number | null;
}

// Pure: map a matched Langfuse trace + the entity's scores into a display row.
export function toTraceRow(trace: LangfuseTrace, scores: LangfuseScore[]): TraceRow {
  return {
    id: trace.id,
    name: (trace.name ?? '').trim() || trace.id,
    userId: trace.userId ?? null,
    timestamp: trace.timestamp ?? null,
    latency: typeof trace.latency === 'number' ? trace.latency : null,
    cost: typeof trace.totalCost === 'number' ? trace.totalCost : null,
    spans: typeof trace.observations === 'number' ? trace.observations : null,
    quality: traceQuality(scores, trace.id),
  };
}

// ─── the assembled entity observability view ────────────────────────────────────────────────────
export interface EntityObservability {
  /** entity id echoed back for the presentation layer */
  entityId: string;
  traceCount: number;
  totalCost: number;
  avgCostPerRun: number | null;
  latency: LatencyStats;
  /** per-named-metric quality trend (faithfulness/toxicity/…), scoped to this entity's traces */
  quality: ScoreTrendSeries[];
  /** the trace rows, newest-first (input order preserved) */
  traces: TraceRow[];
}

// Pure: the whole entity view from the raw org-wide traces + scores. Filters to the entity, joins
// scores, computes cost/latency/quality rollups. Zero network. This is the single shaping seam the
// adapter and every OBSERVE tab reuse — one rule, one place (DRY).
export function rollupEntityObservability(
  traces: LangfuseTrace[],
  scores: LangfuseScore[],
  match: EntityMatch,
): EntityObservability {
  const matched = filterTracesForEntity(traces, match);
  const traceIds = matched.map((t) => t.id);
  const entityScores = filterScoresForTraces(scores, traceIds);
  const costs = matched
    .map((t) => t.totalCost)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  const totalCost = round(costs.reduce((a, b) => a + b, 0));
  return {
    entityId: match.id,
    traceCount: matched.length,
    totalCost,
    avgCostPerRun: matched.length ? round(totalCost / matched.length) : null,
    latency: latencyStats(matched),
    quality: shapeScoreTrends(entityScores),
    traces: matched.map((t) => toTraceRow(t, entityScores)),
  };
}

// An honest empty view — used when tracing is unconfigured/unreachable or the entity has no traces.
export function emptyEntityObservability(entityId: string): EntityObservability {
  return {
    entityId,
    traceCount: 0,
    totalCost: 0,
    avgCostPerRun: null,
    latency: { count: 0, p50: null, p95: null, avg: null, max: null },
    quality: [],
    traces: [],
  };
}

// ─── trace detail: scores for one trace ─────────────────────────────────────────────────────────
export interface TraceScoreRow {
  name: string;
  value: number | null;
  stringValue: string | null;
  dataType: string | null;
  source: string | null;
  comment: string | null;
  timestamp: string | null;
}

// Pure: the scores attached to ONE trace, shaped for the detail view, newest-first. Judge/eval scores
// (faithfulness, toxicity, groundedness…) surface here alongside the span waterfall.
export function scoresForTrace(scores: LangfuseScore[], traceId: string): TraceScoreRow[] {
  return scores
    .filter((s) => s.traceId === traceId)
    .map((s) => ({
      name: (s.name ?? '').trim() || 'unnamed',
      value: typeof s.value === 'number' ? s.value : null,
      stringValue: (s.stringValue ?? '').trim() || null,
      dataType: (s.dataType ?? '').trim() || null,
      source: (s.source ?? '').trim() || null,
      comment: (s.comment ?? '').trim() || null,
      timestamp: (s.timestamp ?? '').trim() || null,
    }))
    .sort((a, b) => {
      if ((a.timestamp ?? '') < (b.timestamp ?? '')) return 1;
      if ((a.timestamp ?? '') > (b.timestamp ?? '')) return -1;
      return a.name.localeCompare(b.name);
    });
}

// ─── time-window narrowing ────────────────────────────────────────────────────────────────────────
// Langfuse's traces list endpoint has no reliable per-entity server-side filter, so the adapter pulls
// a recent page and we narrow client-side by BOTH the entity match AND the selected time window.
// Pure: keep traces whose timestamp falls in [fromIso, toIso]. A trace with no parseable timestamp is
// kept (honest — we don't silently drop a real trace just because its ts is missing/odd). Bounds are
// inclusive; an undefined bound means "unbounded on that side". Input order preserved (newest-first).
export function filterTracesByWindow(
  traces: LangfuseTrace[],
  fromIso?: string,
  toIso?: string,
): LangfuseTrace[] {
  const from = fromIso ? Date.parse(fromIso) : Number.NEGATIVE_INFINITY;
  const to = toIso ? Date.parse(toIso) : Number.POSITIVE_INFINITY;
  return traces.filter((t) => {
    const ts = t.timestamp ? Date.parse(t.timestamp) : Number.NaN;
    if (Number.isNaN(ts)) return true;
    return ts >= from && ts <= to;
  });
}

// ─── trace detail (span waterfall + generation summary) ─────────────────────────────────────────────
// One trace's drill-down: the header metadata (from its list row), the span/generation waterfall, the
// distinct models it touched, and its attached judge/eval scores. Reuses the pure `buildWaterfall`
// (langfuse.ts) and `scoresForTrace` above — no duplicated logic (DRY).
export interface TraceDetail {
  id: string;
  name: string;
  userId: string | null;
  timestamp: string | null;
  latency: number | null;
  cost: number | null;
  /** total span count on the trace */
  spanCount: number;
  /** how many of those spans are LLM generations */
  generationCount: number;
  /** distinct model ids seen across the spans, sorted */
  models: string[];
  spans: WaterfallSpan[];
  scores: TraceScoreRow[];
}

// Pure: is a span an LLM generation? Langfuse types generations as 'GENERATION' (case-insensitive).
function isGeneration(type: string | null | undefined): boolean {
  return (type ?? '').toUpperCase() === 'GENERATION';
}

// Pure: the distinct, sorted model ids referenced by a trace's observations (blank/null dropped).
export function modelsForObservations(obs: LangfuseObservation[]): string[] {
  const set = new Set<string>();
  for (const o of obs) {
    const m = (o.model ?? '').trim();
    if (m) set.add(m);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Pure: assemble a trace's full detail from its list row, its observations, and the entity's scores.
// `row` may be null when the trace metadata wasn't in the recent list page — the detail still renders
// from the observations + scores (honest partial, never fabricated).
export function shapeTraceDetail(
  traceId: string,
  row: TraceRow | null,
  observations: LangfuseObservation[],
  scores: LangfuseScore[],
): TraceDetail {
  return {
    id: traceId,
    name: row?.name ?? traceId,
    userId: row?.userId ?? null,
    timestamp: row?.timestamp ?? null,
    latency: row?.latency ?? null,
    cost: row?.cost ?? null,
    spanCount: observations.length,
    generationCount: observations.filter((o) => isGeneration(o.type)).length,
    models: modelsForObservations(observations),
    spans: buildWaterfall(observations),
    scores: scoresForTrace(scores, traceId),
  };
}
