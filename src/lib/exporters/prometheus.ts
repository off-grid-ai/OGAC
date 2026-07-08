// Prometheus / OTLP metrics exporter — expose the spine's cost/usage metrics for Grafana.
//
// TWO standards-based modes, both from the SAME pure metric model:
//   • SCRAPE (pull): render Prometheus text-exposition format at a `/metrics` endpoint the
//     enterprise's Prometheus scrapes. No endpoint/token needed — Prometheus pulls.
//   • PUSH (OTLP/HTTP): POST an OTLP metrics JSON payload to a configured OTLP collector endpoint.
//
// The render + serialization is pure (text-exposition + OTLP JSON builders below), exhaustively
// tested. The scrape path has no I/O beyond serving text; the push path's fetch is injected so
// export()/test() unit-test without a real collector.

import type { Exporter, ExportResult, FetchLike, ProbeResult, ResolvedTarget } from './types';

const TIMEOUT_MS = 8000;

// A single metric sample the platform exports. `labels` are Prometheus label pairs. `value` is the
// numeric reading. `type` drives the `# TYPE` line; `help` the `# HELP` line.
export interface MetricSample {
  name: string; // e.g. offgrid_requests_total
  help: string;
  type: 'counter' | 'gauge';
  value: number;
  labels?: Record<string, string>;
}

// ── Prometheus text-exposition format (pure) ────────────────────────────────────────────────────
// Escape a label VALUE per the exposition format (backslash, double-quote, newline). Pure.
export function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// Sanitize a metric/label NAME to the allowed charset [a-zA-Z_][a-zA-Z0-9_]*. Pure.
export function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function renderLabels(labels: Record<string, string> | undefined): string {
  const entries = Object.entries(labels ?? {}).filter(([k]) => k.length > 0);
  if (entries.length === 0) return '';
  const inner = entries
    .map(([k, v]) => `${sanitizeName(k)}="${escapeLabelValue(String(v))}"`)
    .join(',');
  return `{${inner}}`;
}

// Render a batch of samples to Prometheus text-exposition format. Groups HELP/TYPE per metric name
// (emitted once), then one line per labelset. Pure — this is the exact `/metrics` body. Numbers that
// aren't finite are dropped (Prometheus rejects NaN/Inf in text format unless explicit).
export function renderPromText(samples: MetricSample[]): string {
  const byName = new Map<string, MetricSample[]>();
  const order: string[] = [];
  for (const s of samples) {
    const name = sanitizeName(s.name);
    if (!byName.has(name)) {
      byName.set(name, []);
      order.push(name);
    }
    byName.get(name)!.push(s);
  }
  const lines: string[] = [];
  for (const name of order) {
    const group = byName.get(name)!;
    const first = group[0];
    lines.push(`# HELP ${name} ${first.help.replace(/\n/g, ' ')}`);
    lines.push(`# TYPE ${name} ${first.type}`);
    for (const s of group) {
      if (!Number.isFinite(s.value)) continue;
      lines.push(`${name}${renderLabels(s.labels)} ${s.value}`);
    }
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

// ── OTLP/HTTP metrics JSON (pure) ─────────────────────────────────────────────────────────────
// A minimal, spec-shaped OTLP ExportMetricsServiceRequest (JSON encoding). Counters map to a Sum
// (monotonic, cumulative); gauges to a Gauge. Timestamps are unix-nanos. Pure.
export function buildOtlpPayload(samples: MetricSample[], nowMs: number): Record<string, unknown> {
  const timeUnixNano = String(Math.round(nowMs) * 1_000_000);
  const toAttrs = (labels: Record<string, string> | undefined) =>
    Object.entries(labels ?? {}).map(([key, value]) => ({
      key,
      value: { stringValue: String(value) },
    }));
  const metrics = samples
    .filter((s) => Number.isFinite(s.value))
    .map((s) => {
      const dp = {
        asDouble: s.value,
        timeUnixNano,
        startTimeUnixNano: timeUnixNano,
        attributes: toAttrs(s.labels),
      };
      if (s.type === 'counter') {
        return {
          name: sanitizeName(s.name),
          description: s.help,
          sum: {
            dataPoints: [dp],
            aggregationTemporality: 2, // CUMULATIVE
            isMonotonic: true,
          },
        };
      }
      return {
        name: sanitizeName(s.name),
        description: s.help,
        gauge: { dataPoints: [dp] },
      };
    });
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'offgrid-console' } }],
        },
        scopeMetrics: [{ scope: { name: 'offgrid.exporters' }, metrics }],
      },
    ],
  };
}

export function otlpHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// Normalize an OTLP endpoint to the metrics ingest path. If the operator gave the collector base,
// append `/v1/metrics`; if they already gave the metrics path, keep it. Pure.
export function otlpUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  return /\/v1\/metrics$/.test(base) ? base : `${base}/v1/metrics`;
}

export const prometheusExporter: Exporter<MetricSample> = {
  id: 'prometheus-otlp',
  kind: 'metrics',

  // test(): if an endpoint is configured we treat it as OTLP push and probe it with an empty
  // payload; if not, it's scrape mode — always "ready" (Prometheus pulls, nothing to reach out to).
  async test(target: ResolvedTarget, fetchImpl: FetchLike): Promise<ProbeResult> {
    if (!target.endpoint || !target.endpoint.trim()) {
      return {
        ok: true,
        detail: 'Scrape mode: metrics served at /metrics for Prometheus to pull.',
      };
    }
    try {
      const res = await fetchImpl(otlpUrl(target.endpoint), {
        method: 'POST',
        headers: otlpHeaders(target.secret),
        body: JSON.stringify(buildOtlpPayload([], Date.now())),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { ok: true, detail: `OTLP collector reachable (HTTP ${res.status}).` };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: `OTLP collector rejected auth (HTTP ${res.status}).` };
      }
      return { ok: false, detail: `OTLP collector returned HTTP ${res.status}.` };
    } catch (e) {
      return { ok: false, detail: `Cannot reach OTLP collector: ${errMsg(e)}` };
    }
  },

  // export(): only meaningful in push (OTLP) mode. In scrape mode there is nothing to push — the
  // records are served synchronously by the /metrics route instead, so export() is a no-op success.
  async export(
    target: ResolvedTarget,
    records: MetricSample[],
    fetchImpl: FetchLike,
  ): Promise<ExportResult> {
    if (!target.endpoint || !target.endpoint.trim()) {
      return { ok: true, count: records.length, detail: 'Scrape mode: served at /metrics (no push).' };
    }
    if (records.length === 0) return { ok: true, count: 0, detail: 'Nothing to export.' };
    try {
      const res = await fetchImpl(otlpUrl(target.endpoint), {
        method: 'POST',
        headers: otlpHeaders(target.secret),
        body: JSON.stringify(buildOtlpPayload(records, Date.now())),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        return { ok: true, count: records.length, detail: `Pushed ${records.length} metrics via OTLP.` };
      }
      return {
        ok: false,
        count: records.length,
        detail: `OTLP collector rejected the batch (HTTP ${res.status}).`,
      };
    } catch (e) {
      return { ok: false, count: records.length, detail: `Export failed: ${errMsg(e)}` };
    }
  },
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
