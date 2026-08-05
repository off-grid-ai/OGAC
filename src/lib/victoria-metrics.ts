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

// EVERY QUERY HERE IS VERIFIED AGAINST THE DEPLOYED STORE'S OWN METRIC LIST.
// Two of these named metrics did not exist (`..._accepted_spans_total`,
// `..._exporter_send_failed_spans_total` — the `_total` suffix is a Prometheus convention this
// collector build does not use), so the charts rendered the honest "Not emitting yet" empty state while
// telemetry was flowing the whole time. A working pipeline reading as dead is worse than a broken one,
// because nobody investigates it.
//
// Check the names before editing this list — do not guess a suffix:
//   curl -s 'http://127.0.0.1:8428/api/v1/label/__name__/values'
//
// Every series is wrapped in `sum(...)`. Without it a chart inherits the collector's full label set
// (`service.instance.id`, `service.version`, `exporter`, `data_type`…) and the legend alone destroys the
// card — three wrapped monospace label sets clipped off the edge.
export const PLATFORM_CHARTS: ChartSpec[] = [
  {
    title: 'Spans received',
    unit: 'spans/s',
    query: 'sum(rate(otelcol_receiver_accepted_spans[5m]))',
    hint: 'No traced activity in this window yet — run a workflow and it appears here.',
  },
  {
    title: 'Spans rejected',
    unit: 'spans/s',
    // Refused (back-pressure) and failed (malformed / pipeline error) are the two ways a span is lost
    // on the way in. Both series exist; the previously-named exporter failure counter does not.
    query: 'sum(rate(otelcol_receiver_refused_spans[5m])) + sum(rate(otelcol_receiver_failed_spans[5m]))',
    hint: 'Nothing was rejected in this window. A flat line here is the healthy reading.',
  },
  {
    title: 'Spans delivered to storage',
    unit: 'spans/s',
    query: 'sum(rate(otelcol_exporter_sent_spans[5m]))',
    hint: 'Nothing delivered in this window yet — this follows the received line once a workflow runs.',
  },
  {
    title: 'Waiting to be written',
    unit: 'items',
    query: 'sum(otelcol_exporter_queue_size)',
    hint: 'Nothing is queued. A flat line at zero here means storage is keeping up.',
  },
];

export interface PlatformMetrics {
  configured: boolean;
  charts: ChartData[];
  targetsUp: number | null; // count of scrape/OTLP targets currently up, if VM exposes `up`
  error?: string;
}

// 24h, not 1h. Measured on the deployment: 0 spans in the last hour and 120 over 24 hours — so an
// hour-wide window renders a flat line at zero on a box that is genuinely doing work, just not
// continuously. A window has to be wide enough to contain the activity it is meant to show.
const RANGE_SECONDS = 24 * 60 * 60;
const STEP_SECONDS = 5 * 60; // 5m resolution — 288 points across 24h, enough shape without noise

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
        // NOT `sum(up)`: nothing scrapes this store — it is remote-write/push-fed, so `up` is never
        // produced and the tile read "awaiting emission" permanently, implying it was on its way.
        // Counting distinct reporting collectors is the equivalent fact that this topology can answer.
        `/api/v1/query?query=${encodeURIComponent('count(count by (service_instance_id) (otelcol_receiver_accepted_spans))')}`,
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
