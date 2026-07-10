// Pure shaping for VictoriaMetrics query responses. ZERO network — this module is unit-tested
// against representative VictoriaMetrics JSON (Prometheus-compatible /api/v1/query{,_range}). The
// thin fetcher that actually talks HTTP lives in `victoria-metrics.ts` (excluded from coverage);
// every branch here is covered by victoria-metrics-shape.test.ts.
//
// VictoriaMetrics answers PromQL/MetricsQL over the Prometheus HTTP API:
//   GET /api/v1/query        → { status, data: { resultType:'vector', result: [{metric, value:[ts,"v"]}] } }
//   GET /api/v1/query_range  → { status, data: { resultType:'matrix', result: [{metric, values:[[ts,"v"]]}] } }
// Values are stringified floats; timestamps are unix seconds (float). We tolerate NaN/Inf/missing.

// ── Raw API shapes ─────────────────────────────────────────────────────────────
export interface PromSample {
  metric?: Record<string, string> | null;
  value?: [number, string] | null; // instant vector
  values?: Array<[number, string]> | null; // range matrix
}
export interface PromQueryResponse {
  status?: string;
  data?: {
    resultType?: string;
    result?: PromSample[] | null;
  } | null;
  error?: string | null;
  errorType?: string | null;
}

// ── Display models ───────────────────────────────────────────────────────────────
export interface MetricPoint {
  t: number; // unix seconds
  v: number | null; // null when the sample was NaN/Inf/unparseable (an honest gap, not 0)
}
export interface MetricSeries {
  // A stable label for the series, derived from its metric labels (e.g. service name), else 'value'.
  label: string;
  metric: Record<string, string>;
  points: MetricPoint[];
}

// Parse a Prometheus stringified float into a finite number, or null for NaN/Inf/garbage. VM emits
// "NaN"/"+Inf"/"-Inf" as strings — those are genuine gaps, NOT zeros, so the chart shows a break.
export function parseSampleValue(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Choose a human label for a series from its metric labels. Prefers a small set of common
// identifying labels, falls back to a compact `{k=v,…}` rendering, else 'value'.
export function seriesLabel(metric: Record<string, string> | null | undefined): string {
  const m = metric ?? {};
  for (const key of ['service', 'service_name', 'job', 'instance', 'le', 'quantile', 'code']) {
    if (m[key]) return m[key];
  }
  const name = m.__name__;
  const rest = Object.entries(m).filter(([k]) => k !== '__name__');
  if (rest.length === 0) return name ?? 'value';
  const inner = rest.map(([k, v]) => `${k}=${v}`).join(',');
  return name ? `${name}{${inner}}` : `{${inner}}`;
}

// Pure: shape an instant OR range query response into normalized series. Instant vectors become a
// single-point series each; range matrices keep their whole point list (oldest→newest, VM already
// orders ascending but we sort to be safe). Missing/empty result → []. Never throws.
export function shapeSeries(res: PromQueryResponse | null | undefined): MetricSeries[] {
  const result = res?.data?.result ?? [];
  if (!Array.isArray(result)) return [];
  return result.map((s) => {
    const metric = s.metric ?? {};
    const points: MetricPoint[] = [];
    if (Array.isArray(s.values)) {
      for (const pair of s.values) {
        if (Array.isArray(pair) && pair.length >= 2) {
          points.push({ t: Number(pair[0]) || 0, v: parseSampleValue(pair[1]) });
        }
      }
    } else if (Array.isArray(s.value) && s.value.length >= 2) {
      points.push({ t: Number(s.value[0]) || 0, v: parseSampleValue(s.value[1]) });
    }
    points.sort((a, b) => a.t - b.t);
    return { label: seriesLabel(metric), metric, points };
  });
}

// Pure: the single scalar of an instant query — the latest finite value of the first series, or
// null if there's none. Used for the "service up" gauge and single-number tiles.
export function scalarValue(res: PromQueryResponse | null | undefined): number | null {
  const series = shapeSeries(res);
  for (const s of series) {
    for (let i = s.points.length - 1; i >= 0; i--) {
      if (s.points[i].v != null) return s.points[i].v;
    }
  }
  return null;
}

// A single chart's worth of data, ready for recharts: a merged row-per-timestamp table across all
// series of one query, plus the series keys. `emitting` is false when NOTHING came back — the UI
// then shows an honest "not emitting yet" state rather than an empty axis pretending to be live.
export interface ChartData {
  title: string;
  unit: string;
  keys: string[]; // series labels → chart line keys
  rows: Array<Record<string, number | string | null>>; // { t, <label>: value, … }
  emitting: boolean;
  error?: string;
}

// Disambiguate duplicate series labels (two series can share a label) so recharts keys stay unique.
function dedupeLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((l) => {
    const n = seen.get(l) ?? 0;
    seen.set(l, n + 1);
    return n === 0 ? l : `${l} #${n + 1}`;
  });
}

// Pure: fold a query response into a recharts-friendly table keyed by timestamp. Each series
// contributes a column named by its label; a timestamp missing from a series yields null (a gap,
// not a zero). Deterministic column order = series order. Never throws.
export function shapeChart(
  title: string,
  unit: string,
  res: PromQueryResponse | null | undefined,
): ChartData {
  const series = shapeSeries(res);
  const keys = dedupeLabels(series.map((s) => s.label));
  const byTs = new Map<number, Record<string, number | string | null>>();
  series.forEach((s, i) => {
    const key = keys[i];
    for (const p of s.points) {
      const row = byTs.get(p.t) ?? { t: p.t };
      row[key] = p.v;
      byTs.set(p.t, row);
    }
  });
  const rows = [...byTs.values()].sort((a, b) => (a.t as number) - (b.t as number));
  const emitting = rows.length > 0 && series.some((s) => s.points.some((p) => p.v != null));
  return { title, unit, keys, rows, emitting, error: res?.error ?? undefined };
}
