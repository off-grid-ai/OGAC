// Thin I/O adapter for the distributed-trace SEARCH surface — the only place that talks to Jaeger's
// query API over the network. Mirrors the repo's read-adapter contract (env base URL, `configured:false`
// when unset, honest errors, never throws into a route). ALL decision/shaping logic lives in the pure,
// unit-tested `src/lib/jaeger-trace.ts`; this file just fetches and delegates. It is intentionally
// excluded from coverage (network glue) — the shaping it calls is covered in full.
//
//   OFFGRID_JAEGER_URL     — Jaeger query API base, e.g. http://127.0.0.1:16686
//   OFFGRID_JAEGER_WEB_URL — optional UI base for deep links (defaults to OFFGRID_JAEGER_URL)
import { jaegerTraceUrl } from '@/lib/jaeger';
import type {
  JaegerServicesResponse,
  JaegerTracesResponse,
} from '@/lib/jaeger-shape';
import {
  type JaegerOperationsResponse,
  type TaggedTrace,
  type TraceHeadline,
  type TraceListRow,
  type TraceSearchInput,
  type WaterfallSpan,
  buildTraceSearchParams,
  buildWaterfall,
  normalizeOperations,
  normalizeServices,
  normalizeTraces,
  traceHeadline,
} from '@/lib/jaeger-trace';

const BASE = process.env.OFFGRID_JAEGER_URL;

type Fetcher = typeof fetch;

export function jaegerTracesConfigured(): boolean {
  return Boolean(BASE);
}

async function jGet<T>(fetcher: Fetcher, path: string): Promise<T> {
  const res = await fetcher(`${BASE}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Jaeger ${res.status}`);
  return (await res.json()) as T;
}

function errMessage(e: unknown): string {
  const err = e as Error & { cause?: { code?: string } };
  return `${err.message}${err.cause?.code ? ` [${err.cause.code}]` : ''}`;
}

export interface ServicesResult {
  configured: boolean;
  services: string[];
  error?: string;
}
export async function fetchTraceServices(fetcher: Fetcher = fetch): Promise<ServicesResult> {
  if (!BASE) return { configured: false, services: [] };
  try {
    const res = await jGet<JaegerServicesResponse>(fetcher, '/api/services');
    return { configured: true, services: normalizeServices(res) };
  } catch (e) {
    return { configured: true, services: [], error: errMessage(e) };
  }
}

export interface OperationsResult {
  configured: boolean;
  operations: string[];
  error?: string;
}
export async function fetchTraceOperations(
  service: string,
  fetcher: Fetcher = fetch,
): Promise<OperationsResult> {
  if (!BASE) return { configured: false, operations: [] };
  try {
    const res = await jGet<JaegerOperationsResponse>(
      fetcher,
      `/api/operations?service=${encodeURIComponent(service)}`,
    );
    return { configured: true, operations: normalizeOperations(res) };
  } catch (e) {
    return { configured: true, operations: [], error: errMessage(e) };
  }
}

export interface TraceSearchResult {
  configured: boolean;
  traces: TraceListRow[];
  webUrl: string | null;
  error?: string;
}
export async function searchTraces(
  input: TraceSearchInput,
  fetcher: Fetcher = fetch,
): Promise<TraceSearchResult> {
  const webUrl = jaegerTraceUrl();
  if (!BASE) return { configured: false, traces: [], webUrl };
  try {
    const qs = buildTraceSearchParams(input);
    const res = await jGet<JaegerTracesResponse>(fetcher, `/api/traces?${qs.toString()}`);
    return { configured: true, traces: normalizeTraces(res), webUrl };
  } catch (e) {
    return { configured: true, traces: [], webUrl, error: errMessage(e) };
  }
}

export interface TraceDetailResult {
  configured: boolean;
  traceId: string;
  headline: TraceHeadline | null;
  spans: WaterfallSpan[];
  webUrl: string | null;
  error?: string;
}
export async function fetchTraceDetail(
  traceId: string,
  fetcher: Fetcher = fetch,
): Promise<TraceDetailResult> {
  const webUrl = jaegerTraceUrl(traceId);
  if (!BASE) return { configured: false, traceId, headline: null, spans: [], webUrl };
  try {
    const res = await jGet<JaegerTracesResponse>(
      fetcher,
      `/api/traces/${encodeURIComponent(traceId)}`,
    );
    const trace = (res.data?.[0] ?? null) as TaggedTrace | null;
    return {
      configured: true,
      traceId,
      headline: trace ? traceHeadline(trace) : null,
      spans: buildWaterfall(trace),
      webUrl,
    };
  } catch (e) {
    return { configured: true, traceId, headline: null, spans: [], webUrl, error: errMessage(e) };
  }
}
