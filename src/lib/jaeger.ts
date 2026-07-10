// Jaeger read adapter. Spans are fanned out to Jaeger by the OTel collector (see
// deploy/otel-collector.yaml); this reads the resulting services + recent traces back through
// Jaeger's query API so the Platform-health Traces tab lists live services and recent traces
// in-console (with a deep link out to the Jaeger UI for the full waterfall). Identical contract to
// the Langfuse/Marquez read adapters: env base URL, a `safe*` reader returning a typed empty view +
// `configured:false` when unset/unreachable (never throws into the page), all SHAPING split into
// `jaeger-shape.ts`.
//
//   OFFGRID_JAEGER_URL     — Jaeger query API base, e.g. http://127.0.0.1:16686
//   OFFGRID_JAEGER_WEB_URL — optional UI base for deep links (defaults to OFFGRID_JAEGER_URL)
import {
  type JaegerServicesResponse,
  type JaegerTrace,
  type JaegerTracesResponse,
  type TraceSpanRow,
  type TraceSummary,
  shapeServices,
  shapeTraceSpans,
  shapeTraces,
} from './jaeger-shape';

const BASE = process.env.OFFGRID_JAEGER_URL;
const WEB = process.env.OFFGRID_JAEGER_WEB_URL ?? process.env.OFFGRID_JAEGER_URL;

type Fetcher = typeof fetch;

export function jaegerConfigured(): boolean {
  return Boolean(BASE);
}

// Deep link to a trace (or the search view) in the Jaeger UI, or null when no web URL is set.
export function jaegerTraceUrl(traceId?: string): string | null {
  if (!WEB) return null;
  return traceId ? `${WEB}/trace/${encodeURIComponent(traceId)}` : `${WEB}/search`;
}

async function jGet<T>(base: string, fetcher: Fetcher, path: string): Promise<T> {
  const res = await fetcher(`${base}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Jaeger ${res.status}`);
  return (await res.json()) as T;
}

export interface JaegerOverview {
  configured: boolean;
  services: string[];
  traces: TraceSummary[];
  selectedService: string | null;
  webUrl: string | null;
  error?: string;
}

// Best-effort read-back for the Traces tab — never throws. Lists services, then recent traces for
// the chosen service (defaults to the first service). Unconfigured → typed empty + configured:false.
export async function safeJaegerOverview(
  service?: string,
  limit = 20,
  fetcher: Fetcher = fetch,
): Promise<JaegerOverview> {
  const webUrl = jaegerTraceUrl();
  if (!BASE) {
    return { configured: false, services: [], traces: [], selectedService: null, webUrl };
  }
  try {
    const svcRes = await jGet<JaegerServicesResponse>(BASE, fetcher, '/api/services');
    const services = shapeServices(svcRes);
    const selected =
      service && services.includes(service) ? service : services.length ? services[0] : null;
    let traces: TraceSummary[] = [];
    if (selected) {
      const qs = new URLSearchParams({
        service: selected,
        limit: String(Math.min(Math.max(limit, 1), 100)),
        lookback: '1h',
      });
      const trRes = await jGet<JaegerTracesResponse>(BASE, fetcher, `/api/traces?${qs.toString()}`);
      traces = shapeTraces(trRes);
    }
    return { configured: true, services, traces, selectedService: selected, webUrl };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    return {
      configured: true,
      services: [],
      traces: [],
      selectedService: null,
      webUrl,
      error: `${err.message}${err.cause?.code ? ` [${err.cause.code}]` : ''}`,
    };
  }
}

export interface TraceDetailResult {
  configured: boolean;
  spans: TraceSpanRow[];
  traceId: string;
  webUrl: string | null;
  error?: string;
}

// Read one trace's spans (for an in-console waterfall). Best-effort — never throws.
export async function safeTraceDetail(
  traceId: string,
  fetcher: Fetcher = fetch,
): Promise<TraceDetailResult> {
  const webUrl = jaegerTraceUrl(traceId);
  if (!BASE) return { configured: false, spans: [], traceId, webUrl };
  try {
    const res = await jGet<JaegerTracesResponse>(
      BASE,
      fetcher,
      `/api/traces/${encodeURIComponent(traceId)}`,
    );
    const trace: JaegerTrace | undefined = res.data?.[0];
    return { configured: true, spans: shapeTraceSpans(trace), traceId, webUrl };
  } catch (e) {
    return { configured: true, spans: [], traceId, webUrl, error: (e as Error).message };
  }
}
