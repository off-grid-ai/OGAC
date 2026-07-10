// VictoriaMetrics read adapter. Metrics are pushed to VictoriaMetrics via the OTel collector
// (see deploy/otel-collector.yaml — OTLP in → remote-write to VM); this reads them back through
// VM's Prometheus-compatible HTTP API so the Platform-health page renders real charts instead of
// nothing. Identical contract to the Langfuse/Marquez read adapters: an env base URL, a `safe*`
// reader that returns a typed empty view + `configured:false` when unset/unreachable (never throws
// into the page), and all response SHAPING split into the pure `victoria-metrics-shape.ts` sibling.
//
//   OFFGRID_VICTORIAMETRICS_URL — e.g. http://127.0.0.1:8428
import {
  type ChartData,
  type PromQueryResponse,
  shapeChart,
  scalarValue,
} from './victoria-metrics-shape';

const BASE = process.env.OFFGRID_VICTORIAMETRICS_URL;

// Injectable fetch so the adapter is testable without a live server (mirrors the injected-fetch
// pattern). Defaults to global fetch.
type Fetcher = typeof fetch;

export function victoriaMetricsConfigured(): boolean {
  return Boolean(BASE);
}

async function vmQuery(base: string, fetcher: Fetcher, path: string): Promise<PromQueryResponse> {
  const res = await fetcher(`${base}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`VictoriaMetrics ${res.status}`);
  return (await res.json()) as PromQueryResponse;
}

// The platform charts we try to render. Each is a MetricsQL query; if VM returns nothing the chart
// falls to an honest "not emitting yet" empty state (emitting:false) — never fabricated numbers.
// These target the OTel collector's own self-telemetry + any app metrics on the same VM; when the
// app isn't emitting a given series yet, that chart is simply empty-pending-emission.
export interface ChartSpec {
  title: string;
  unit: string;
  query: string; // instant is derived by wrapping; range uses this directly
  hint: string; // one-line "why empty" hint shown in the honest empty state
}

export const PLATFORM_CHARTS: ChartSpec[] = [
  {
    title: 'Request rate',
    unit: 'req/s',
    query: 'sum(rate(otelcol_receiver_accepted_spans_total[5m]))',
    hint: 'No span/request throughput reported yet — awaiting OTel receiver traffic.',
  },
  {
    title: 'Error rate',
    unit: 'err/s',
    query: 'sum(rate(otelcol_exporter_send_failed_spans_total[5m]))',
    hint: 'No export failures reported (good) or the exporter is not emitting counters yet.',
  },
  {
    title: 'Data points processed',
    unit: 'pts/s',
    query: 'sum(rate(otelcol_processor_batch_batch_send_size_sum[5m]))',
    hint: 'No processed data points yet — awaiting pipeline throughput.',
  },
  {
    title: 'Collector queue size',
    unit: 'items',
    query: 'otelcol_exporter_queue_size',
    hint: 'No exporter queue metric yet — awaiting OTel collector self-telemetry.',
  },
];

export interface PlatformMetrics {
  configured: boolean;
  charts: ChartData[];
  targetsUp: number | null; // count of scrape/OTLP targets currently up, if VM exposes `up`
  error?: string;
}

const RANGE_SECONDS = 60 * 60; // 1h window
const STEP_SECONDS = 60; // 1m resolution

// Best-effort combined read-back for the Metrics tab — never throws. Each chart is fetched via
// query_range; a per-chart failure yields an empty-but-honest chart, not a page error. `now` is
// injectable for deterministic tests.
export async function safePlatformMetrics(
  fetcher: Fetcher = fetch,
  now: Date = new Date(),
): Promise<PlatformMetrics> {
  if (!BASE) return { configured: false, charts: [], targetsUp: null };
  const end = Math.floor(now.getTime() / 1000);
  const start = end - RANGE_SECONDS;
  const rangeQs = (q: string) =>
    `/api/v1/query_range?query=${encodeURIComponent(q)}&start=${start}&end=${end}&step=${STEP_SECONDS}`;
  try {
    const charts = await Promise.all(
      PLATFORM_CHARTS.map(async (spec) => {
        try {
          const res = await vmQuery(BASE, fetcher, rangeQs(spec.query));
          return shapeChart(spec.title, spec.unit, res);
        } catch (e) {
          return shapeChart(spec.title, spec.unit, { error: (e as Error).message });
        }
      }),
    );
    let targetsUp: number | null = null;
    try {
      const upRes = await vmQuery(
        BASE,
        fetcher,
        `/api/v1/query?query=${encodeURIComponent('sum(up)')}`,
      );
      targetsUp = scalarValue(upRes);
    } catch {
      targetsUp = null;
    }
    return { configured: true, charts, targetsUp };
  } catch (e) {
    return { configured: true, charts: [], targetsUp: null, error: (e as Error).message };
  }
}

// Run one ad-hoc MetricsQL instant query (for the "run a query" box on the Metrics tab). Best-effort.
export async function safeInstantQuery(
  query: string,
  fetcher: Fetcher = fetch,
): Promise<ChartData> {
  if (!BASE) return shapeChart(query, '', null);
  try {
    const res = await vmQuery(BASE, fetcher, `/api/v1/query?query=${encodeURIComponent(query)}`);
    return shapeChart(query, '', res);
  } catch (e) {
    return shapeChart(query, '', { error: (e as Error).message });
  }
}
