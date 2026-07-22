// VictoriaMetrics I/O adapter for the metric-explorer + alerts surface. This is the THIN HTTP half:
// it reads the env base URL, talks the Prometheus-compatible HTTP API, and returns honest
// {configured:false} / {error} envelopes — never throwing into a route. ALL decisions/shaping are
// pure and live in ../victoriametrics-query.ts (unit-tested); this file has no branch logic beyond
// ok/!ok + configured, so it is excluded from unit coverage and verified by integration + live probe.
//
//   OFFGRID_VICTORIAMETRICS_URL — e.g. http://127.0.0.1:8428 (deployed; no auth on the instance).
//
// The sibling ../victoria-metrics.ts is the PRESET-CHART reader for the platform-health tab; this
// adapter is the ARBITRARY-QUERY explorer + rules/alerts reader. Both share the one shaping module.
import {
  type PromQueryResponse,
  type RawAlertsResponse,
  type RawRulesResponse,
  type RangeParams,
  buildInstantQueryString,
  buildRangeQueryString,
} from '@/lib/victoriametrics-query';

const BASE = process.env.OFFGRID_VICTORIAMETRICS_URL;
const TIMEOUT_MS = 6000;

// Injectable fetch so the adapter is exercisable without a live server (mirrors the injected-fetch
// pattern in ../victoria-metrics.ts). Defaults to global fetch.
type Fetcher = typeof fetch;

export function victoriaMetricsConfigured(): boolean {
  return Boolean(BASE);
}

async function vmGetJson(base: string, path: string, fetcher: Fetcher): Promise<unknown> {
  const res = await fetcher(`${base}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`VictoriaMetrics ${res.status}`);
  return res.json();
}

// ── Query result envelope ─────────────────────────────────────────────────────
export interface QueryResult {
  configured: boolean;
  response?: PromQueryResponse; // raw Prometheus body; routes shape via shapeChart (pure)
  error?: string;
}

// Instant query — the "latest value" readout + single-point chart.
export async function instantQuery(
  query: string,
  time: number | undefined = undefined,
  fetcher: Fetcher = fetch,
): Promise<QueryResult> {
  if (!BASE) return { configured: false };
  try {
    const response = (await vmGetJson(
      BASE,
      buildInstantQueryString(query, time),
      fetcher,
    )) as PromQueryResponse;
    return { configured: true, response };
  } catch (e) {
    return { configured: true, error: (e as Error).message };
  }
}

// Range query — the time-series chart.
export async function rangeQuery(
  query: string,
  range: RangeParams,
  fetcher: Fetcher = fetch,
): Promise<QueryResult> {
  if (!BASE) return { configured: false };
  try {
    const response = (await vmGetJson(
      BASE,
      buildRangeQueryString(query, range),
      fetcher,
    )) as PromQueryResponse;
    return { configured: true, response };
  } catch (e) {
    return { configured: true, error: (e as Error).message };
  }
}

// ── Metric-name picker ──────────────────────────────────────────────────────────
export interface MetricNamesResult {
  configured: boolean;
  names: string[];
  error?: string;
}

// The full metric-name catalogue for the explorer's picker (/api/v1/label/__name__/values).
export async function metricNames(fetcher: Fetcher = fetch): Promise<MetricNamesResult> {
  if (!BASE) return { configured: false, names: [] };
  try {
    const body = (await vmGetJson(BASE, '/api/v1/label/__name__/values', fetcher)) as {
      data?: string[] | null;
    };
    const names = Array.isArray(body?.data) ? body.data.slice().sort() : [];
    return { configured: true, names };
  } catch (e) {
    return { configured: true, names: [], error: (e as Error).message };
  }
}

// ── Rules + alerts ────────────────────────────────────────────────────────────
// HONESTY: /api/v1/rules + /api/v1/alerts only exist when a rule engine (vmalert) is deployed against
// this VM. A plain VictoriaMetrics single-node does NOT serve them (404 / connection error). We
// report `engineDeployed:false` in that case so the UI shows an honest "no alerting engine deployed"
// state — we never invent rules the service can't back.
export interface RulesAlertsResult {
  configured: boolean;
  engineDeployed: boolean;
  rules?: RawRulesResponse;
  alerts?: RawAlertsResponse;
  error?: string;
}

export async function rulesAndAlerts(fetcher: Fetcher = fetch): Promise<RulesAlertsResult> {
  if (!BASE) return { configured: false, engineDeployed: false };
  try {
    const [rules, alerts] = await Promise.all([
      vmGetJson(BASE, '/api/v1/rules', fetcher) as Promise<RawRulesResponse>,
      vmGetJson(BASE, '/api/v1/alerts', fetcher) as Promise<RawAlertsResponse>,
    ]);
    return { configured: true, engineDeployed: true, rules, alerts };
  } catch (e) {
    // 404 (no vmalert) or a connection error — engine not deployed. Surfaced honestly, not as a
    // hard error, so the UI renders the "no alerting engine" empty state.
    return { configured: true, engineDeployed: false, error: (e as Error).message };
  }
}
