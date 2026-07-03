// Langfuse read-back. Spans are pushed to Langfuse via OTLP (see src/lib/otel.ts); this reads them
// back through Langfuse's public REST API (Basic auth, public-key:secret-key) so the Observability
// page can render a real trace list + span waterfall instead of only the local run store.
//
// Push side (documented for S1):
//   OFFGRID_LANGFUSE_OTLP_URL  — e.g. http://192.168.1.60:3030/api/public/otel
//   OFFGRID_LANGFUSE_AUTH      — base64("pk-lf-...:sk-lf-...")
// Read side:
//   OFFGRID_LANGFUSE_URL       — e.g. http://192.168.1.60:3030
//   OFFGRID_LANGFUSE_PUBLIC_KEY / OFFGRID_LANGFUSE_SECRET_KEY  (falls back to decoding *_AUTH)
const BASE = process.env.OFFGRID_LANGFUSE_URL;
const PK = process.env.OFFGRID_LANGFUSE_PUBLIC_KEY;
const SK = process.env.OFFGRID_LANGFUSE_SECRET_KEY;

// Derive Basic-auth header. Prefer explicit pk/sk; otherwise reuse the base64 OTLP auth blob.
function authHeader(): string | null {
  if (PK && SK) return `Basic ${Buffer.from(`${PK}:${SK}`).toString('base64')}`;
  const otlp = process.env.OFFGRID_LANGFUSE_AUTH;
  return otlp ? `Basic ${otlp}` : null;
}

export function langfuseReadConfigured(): boolean {
  return Boolean(BASE) && authHeader() !== null;
}

async function lfGet<T>(path: string): Promise<T> {
  const auth = authHeader();
  if (!BASE || !auth) throw new Error('Langfuse read-back not configured');
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { authorization: auth, accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Langfuse ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    // Surface the real transport cause (ECONNREFUSED/ETIMEDOUT/EHOSTUNREACH…) so a bare
    // "fetch failed" isn't opaque when the backing service is unreachable.
    const err = e as Error & { cause?: { code?: string } };
    throw new Error(`${err.message}${err.cause?.code ? ` [${err.cause.code}]` : ''}`);
  }
}

export interface LangfuseTrace {
  id: string;
  name?: string | null;
  timestamp?: string;
  userId?: string | null;
  latency?: number | null;
  totalCost?: number | null;
  observations?: number;
}

export interface LangfuseObservation {
  id: string;
  traceId: string;
  type: string;
  name?: string | null;
  startTime?: string;
  endTime?: string | null;
  parentObservationId?: string | null;
  model?: string | null;
  latency?: number | null;
}

interface Paged<T> {
  data: T[];
}

// GET /api/public/traces — recent traces, newest first.
export async function listTraces(limit = 30): Promise<LangfuseTrace[]> {
  const json = await lfGet<Paged<LangfuseTrace>>(
    `/api/public/traces?limit=${Math.min(limit, 100)}&orderBy=timestamp.desc`,
  );
  return json.data ?? [];
}

// GET /api/public/observations?traceId=... — the spans of one trace (for the waterfall).
export async function listObservations(traceId: string): Promise<LangfuseObservation[]> {
  const json = await lfGet<Paged<LangfuseObservation>>(
    `/api/public/observations?traceId=${encodeURIComponent(traceId)}&limit=100`,
  );
  return json.data ?? [];
}

export interface TraceListResult {
  configured: boolean;
  traces: LangfuseTrace[];
  error?: string;
}

// Best-effort wrapper for the page — never throws.
export async function safeListTraces(limit = 30): Promise<TraceListResult> {
  if (!langfuseReadConfigured()) return { configured: false, traces: [] };
  try {
    return { configured: true, traces: await listTraces(limit) };
  } catch (e) {
    return { configured: true, traces: [], error: (e as Error).message };
  }
}

// Compute a normalized waterfall (offset + width in %) from observation start/end times.
export interface WaterfallSpan {
  id: string;
  name: string;
  type: string;
  model?: string | null;
  offsetPct: number;
  widthPct: number;
  durationMs: number;
  depth: number;
}

export function buildWaterfall(obs: LangfuseObservation[]): WaterfallSpan[] {
  if (!obs.length) return [];
  const times = obs.map((o) => ({
    start: o.startTime ? Date.parse(o.startTime) : 0,
    end: o.endTime ? Date.parse(o.endTime) : (o.startTime ? Date.parse(o.startTime) : 0),
    o,
  }));
  const min = Math.min(...times.map((t) => t.start));
  const max = Math.max(...times.map((t) => t.end));
  const span = Math.max(max - min, 1);
  const depthOf = new Map<string, number>();
  const depth = (o: LangfuseObservation): number => {
    if (!o.parentObservationId) return 0;
    if (depthOf.has(o.id)) return depthOf.get(o.id)!;
    const parent = obs.find((p) => p.id === o.parentObservationId);
    const d = parent ? depth(parent) + 1 : 1;
    depthOf.set(o.id, d);
    return d;
  };
  return times
    .sort((a, b) => a.start - b.start)
    .map((t) => ({
      id: t.o.id,
      name: t.o.name ?? t.o.type,
      type: t.o.type,
      model: t.o.model,
      offsetPct: ((t.start - min) / span) * 100,
      widthPct: Math.max(((t.end - t.start) / span) * 100, 1),
      durationMs: t.end - t.start,
      depth: depth(t.o),
    }));
}
