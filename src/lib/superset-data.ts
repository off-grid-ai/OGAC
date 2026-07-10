// Native Superset DATA client — the replacement for the iframe embed.
//
// Instead of framing the Superset UI, the console asks Superset (the governed query/semantic engine)
// to RUN each provisioned chart's query via its REST chart-data API and hands back the raw rows; we
// then render them with OUR recharts components (see NativeSupersetPanel). Superset stays the engine;
// the console owns the presentation.
//
// SOLID: this module is pure I/O — auth + fetch only. EVERY parse/shape/decision is delegated to the
// zero-IO src/lib/superset-data-shape.ts (unit-tested). It reuses the ONE Superset login path
// (authSession/authHeaders from superset.ts) so credentials live in one place (DRY). Graceful-degrade
// exactly like victoria-metrics.ts / langfuse.ts: returns { configured:false } when unset and a typed
// empty view + error string when unreachable — never throws into the page.
import {
  CHART_REQUESTS_OVER_TIME,
  CHART_TOKENS_BY_MODEL,
} from './superset-provision';
import {
  type NativeChartData,
  type SupersetChartDataResponse,
  type SupersetChartSpec,
  shapeChart,
} from './superset-data-shape';
import { authHeaders, authSession, supersetBase, supersetConfigured } from './superset';

// Injectable fetch so the adapter is testable without a live Superset (mirrors victoria-metrics.ts).
type Fetcher = typeof fetch;

// The charts we render natively, keyed by the stable slice_name the provisioner creates. Each maps a
// Superset slice to a native recharts card. When a slice isn't found (not provisioned yet) it simply
// yields an honest empty card, never an error page.
const NATIVE_CHARTS: Array<Omit<SupersetChartSpec, 'chartId'> & { sliceName: string }> = [
  {
    id: 'requests-over-time',
    sliceName: CHART_REQUESTS_OVER_TIME,
    title: 'Requests over time',
    kind: 'line',
  },
  {
    id: 'tokens-by-model',
    sliceName: CHART_TOKENS_BY_MODEL,
    title: 'Tokens by model',
    kind: 'bar',
  },
];

export interface NativeSupersetDashboard {
  configured: boolean;
  supersetBase?: string; // for the "Open in Superset" link-out
  charts: NativeChartData[];
  error?: string;
}

interface ChartRow {
  id: number;
  slice_name?: string;
}

// Map the provisioner's slice names → Superset slice ids via the chart LIST endpoint.
async function chartIdsBySliceName(
  base: string,
  headers: Record<string, string>,
  fetcher: Fetcher,
): Promise<Map<string, number>> {
  const res = await fetcher(`${base}/api/v1/chart/?q=(page_size:100)`, {
    headers,
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Superset chart list ${res.status}`);
  const json = (await res.json()) as { result?: ChartRow[] };
  const map = new Map<string, number>();
  for (const c of json.result ?? []) {
    if (c.slice_name) map.set(c.slice_name, c.id);
  }
  return map;
}

// Run one chart's query through Superset's chart-data API → raw result rows for our pure shaper.
async function chartData(
  base: string,
  headers: Record<string, string>,
  chartId: number,
  fetcher: Fetcher,
): Promise<SupersetChartDataResponse> {
  const res = await fetcher(`${base}/api/v1/chart/${chartId}/data`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ datasource: undefined, form_data: { slice_id: chartId }, force: false }),
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!res.ok) {
    // Surface Superset's own error message when it returns a JSON error body.
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return { message: body.message ?? `chart-data ${res.status}` };
  }
  return (await res.json()) as SupersetChartDataResponse;
}

// Best-effort native dashboard read-back — never throws. Resolves each configured slice to its id,
// runs its query, and shapes the rows for recharts. A per-chart failure yields an honest empty card
// (not a page error); an auth/list failure degrades the whole panel to configured-but-empty + error.
export async function safeSupersetDashboard(
  fetcher: Fetcher = fetch,
): Promise<NativeSupersetDashboard> {
  const base = supersetBase();
  if (!supersetConfigured() || !base) return { configured: false, charts: [] };
  try {
    const session = await authSession();
    const headers = authHeaders(session, false);
    const ids = await chartIdsBySliceName(base, headers, fetcher);
    const charts = await Promise.all(
      NATIVE_CHARTS.map(async (spec) => {
        const chartId = ids.get(spec.sliceName);
        if (chartId == null) {
          // Slice not provisioned yet → honest empty card, no query.
          return shapeChart({ ...spec, chartId: -1 }, null);
        }
        try {
          const res = await chartData(base, headers, chartId, fetcher);
          return shapeChart({ ...spec, chartId }, res);
        } catch (e) {
          return shapeChart({ ...spec, chartId }, { message: (e as Error).message });
        }
      }),
    );
    return { configured: true, supersetBase: base, charts };
  } catch (e) {
    return { configured: true, supersetBase: base, charts: [], error: (e as Error).message };
  }
}
