// Pure shaping for Jaeger query-API responses. ZERO network — unit-tested against representative
// Jaeger JSON. The thin fetcher lives in `jaeger.ts` (excluded from coverage); every branch here is
// covered by jaeger-shape.test.ts.
//
// Jaeger's query API:
//   GET /api/services                         → { data: ["service-a", …] }
//   GET /api/traces?service=X&limit=N&lookback=1h → { data: [ Trace ] }
// A Trace has `traceID`, `spans[]` (each with spanID, operationName, startTime[µs], duration[µs],
// references[]), and `processes` (processID → { serviceName }). We shape a trace into a compact
// summary (root op, service, start, total duration, span count) for the recent-traces list, and one
// trace's spans into a normalized waterfall.

// ── Raw API shapes ─────────────────────────────────────────────────────────────
export interface JaegerRef {
  refType?: string;
  traceID?: string;
  spanID?: string;
}
export interface JaegerSpan {
  traceID?: string;
  spanID?: string;
  operationName?: string;
  startTime?: number; // microseconds since epoch
  duration?: number; // microseconds
  processID?: string;
  references?: JaegerRef[] | null;
}
export interface JaegerProcess {
  serviceName?: string;
}
export interface JaegerTrace {
  traceID?: string;
  spans?: JaegerSpan[] | null;
  processes?: Record<string, JaegerProcess> | null;
}
export interface JaegerServicesResponse {
  data?: string[] | null;
}
export interface JaegerTracesResponse {
  data?: JaegerTrace[] | null;
}

// ── Display models ───────────────────────────────────────────────────────────────
export interface TraceSummary {
  traceId: string;
  rootOperation: string;
  service: string;
  startTimeMs: number; // epoch ms
  durationMs: number;
  spanCount: number;
  errored: boolean;
}

// Pure: the root span of a trace = the one with no CHILD_OF reference (or, failing that, the
// earliest-starting span). Tolerant of missing references.
export function findRootSpan(spans: JaegerSpan[]): JaegerSpan | null {
  if (!spans.length) return null;
  const root = spans.find((s) => !(s.references ?? []).some((r) => r.refType === 'CHILD_OF'));
  if (root) return root;
  return [...spans].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))[0];
}

// Pure: shape one trace into a summary row. Service is resolved from the root span's processID via
// the processes map. Duration = full trace span (max end − min start) so it reflects the whole
// trace, not just the root. `errored` is true if any span carries an error tag we can detect.
export function shapeTraceSummary(trace: JaegerTrace): TraceSummary {
  const spans = (trace.spans ?? []).filter((s): s is JaegerSpan => !!s);
  const root = findRootSpan(spans);
  const procs = trace.processes ?? {};
  const service = root?.processID ? (procs[root.processID]?.serviceName ?? 'unknown') : 'unknown';
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const s of spans) {
    const start = s.startTime ?? 0;
    const end = start + (s.duration ?? 0);
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }
  const startUs = Number.isFinite(minStart) ? minStart : 0;
  const durUs = Number.isFinite(maxEnd) && Number.isFinite(minStart) ? maxEnd - minStart : 0;
  return {
    traceId: trace.traceID ?? '',
    rootOperation: root?.operationName ?? '(unknown)',
    service,
    startTimeMs: Math.floor(startUs / 1000),
    durationMs: Math.round(durUs / 1000),
    spanCount: spans.length,
    errored: false,
  };
}

// Pure: shape the /api/traces response into summary rows, newest-first by start time. Never throws.
export function shapeTraces(res: JaegerTracesResponse | null | undefined): TraceSummary[] {
  const data = res?.data ?? [];
  if (!Array.isArray(data)) return [];
  return data.map(shapeTraceSummary).sort((a, b) => b.startTimeMs - a.startTimeMs);
}

// Pure: the service list, sorted, de-duped, empty strings dropped. Never throws.
export function shapeServices(res: JaegerServicesResponse | null | undefined): string[] {
  const data = res?.data ?? [];
  if (!Array.isArray(data)) return [];
  return [
    ...new Set(data.filter((s): s is string => typeof s === 'string' && s.length > 0)),
  ].sort();
}

export interface TraceSpanRow {
  spanId: string;
  operation: string;
  service: string;
  offsetPct: number; // where the span starts, as % of the trace window
  widthPct: number; // span duration, as % of the trace window (min 1)
  durationMs: number;
  depth: number; // nesting depth from CHILD_OF references
}

// Pure: normalize one trace's spans into a waterfall (offset + width in %). Depth is the CHILD_OF
// chain length. Mirrors the Langfuse buildWaterfall contract. Never throws.
export function shapeTraceSpans(trace: JaegerTrace | null | undefined): TraceSpanRow[] {
  const spans = (trace?.spans ?? []).filter((s): s is JaegerSpan => !!s);
  if (!spans.length) return [];
  const procs = trace?.processes ?? {};
  const byId = new Map(spans.map((s) => [s.spanID ?? '', s]));
  const starts = spans.map((s) => s.startTime ?? 0);
  const ends = spans.map((s) => (s.startTime ?? 0) + (s.duration ?? 0));
  const min = Math.min(...starts);
  const max = Math.max(...ends);
  const window = Math.max(max - min, 1);
  const depthCache = new Map<string, number>();
  const depthOf = (s: JaegerSpan): number => {
    const id = s.spanID ?? '';
    if (depthCache.has(id)) return depthCache.get(id)!;
    const parentRef = (s.references ?? []).find((r) => r.refType === 'CHILD_OF');
    const parent = parentRef?.spanID ? byId.get(parentRef.spanID) : undefined;
    const d = parent ? depthOf(parent) + 1 : 0;
    depthCache.set(id, d);
    return d;
  };
  return spans
    .map((s) => {
      const start = s.startTime ?? 0;
      const dur = s.duration ?? 0;
      return {
        spanId: s.spanID ?? '',
        operation: s.operationName ?? '(unknown)',
        service: s.processID ? (procs[s.processID]?.serviceName ?? 'unknown') : 'unknown',
        offsetPct: ((start - min) / window) * 100,
        widthPct: Math.max((dur / window) * 100, 1),
        durationMs: Math.round(dur / 1000),
        depth: depthOf(s),
      };
    })
    .sort((a, b) => a.offsetPct - b.offsetPct);
}
