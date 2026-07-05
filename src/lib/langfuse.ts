// Langfuse read-back. Spans are pushed to Langfuse via OTLP (see src/lib/otel.ts); this reads them
// back through Langfuse's public REST API (Basic auth, public-key:secret-key) so the Observability
// page can render a real trace list + span waterfall instead of only the local run store.
//
// Push side (documented for S1):
//   OFFGRID_LANGFUSE_OTLP_URL  — e.g. http://offgrid-g6.local:3030/api/public/otel
//   OFFGRID_LANGFUSE_AUTH      — base64("pk-lf-...:sk-lf-...")
// Read side:
//   OFFGRID_LANGFUSE_URL       — e.g. http://offgrid-g6.local:3030
//   OFFGRID_LANGFUSE_PUBLIC_KEY / OFFGRID_LANGFUSE_SECRET_KEY  (falls back to decoding *_AUTH)
//
// Phase 4.10-B: the Basic-auth project keys now flow through the service-token broker
// (`getServiceCredential('langfuse')`). The broker's per-service plan classifies langfuse as
// 'native-basic', so it returns a `{ kind:'basic', publicKey, secretKey }` project keypair (pk:sk) —
// NOT a Keycloak JWT (Langfuse's REST API is HTTP Basic, it doesn't validate KC tokens). When OpenBao
// has the keypair provisioned it's preferred; until then the broker returns `kind:'none'` and we fall
// back to the current env keys UNCHANGED — byte-identical to today. Selection is the pure, unit-tested
// `chooseLangfuseAuth`.
import { getServiceCredential } from './service-credentials';
import { chooseLangfuseAuth, NO_CREDENTIAL } from './service-credentials-lib';

const BASE = process.env.OFFGRID_LANGFUSE_URL;
const PK = process.env.OFFGRID_LANGFUSE_PUBLIC_KEY;
const SK = process.env.OFFGRID_LANGFUSE_SECRET_KEY;

const b64 = (s: string) => Buffer.from(s).toString('base64');

// The legacy env-derived Basic header: explicit pk/sk, else the base64 OTLP auth blob. Kept as the
// fallback branch; `chooseLangfuseAuth` prefers a broker keypair over this.
function legacyAuthHeader(): string | null {
  if (PK && SK) return `Basic ${b64(`${PK}:${SK}`)}`;
  const otlp = process.env.OFFGRID_LANGFUSE_AUTH;
  return otlp ? `Basic ${otlp}` : null;
}

// Broker-preferring Basic header (async). Broker keypair wins; else the legacy env header; else null.
async function authHeader(): Promise<string | null> {
  const cred = await getServiceCredential('langfuse');
  return chooseLangfuseAuth(cred, legacyAuthHeader(), b64);
}

// Synchronous "is read-back configured?" — reflects env only (the broker is async + returns `none`
// until provisioned, so this stays byte-identical to today: a broker keypair simply becomes usable
// once present without flipping this gate before it's provisioned).
export function langfuseReadConfigured(): boolean {
  return Boolean(BASE) && chooseLangfuseAuth(NO_CREDENTIAL, legacyAuthHeader(), b64) !== null;
}

async function lfGet<T>(path: string): Promise<T> {
  const auth = await authHeader();
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
