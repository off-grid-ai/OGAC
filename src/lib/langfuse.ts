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

// ── Cost/usage + eval-score read-back ──────────────────────────────────────
// Langfuse emits per-trace cost + usage and per-trace eval scores. The console never read these
// back — FinOps cost comes only from the gateway/audit index, and score trends were never surfaced.
// These functions close that gap as a pure READ-BACK: they shape Langfuse's public-API JSON into
// display models. They do NOT feed the audit-log-derived FinOps core — this is a distinct,
// Langfuse-sourced view. All shaping below is pure + unit-tested against representative JSON.

// GET /api/public/metrics/daily response — one row per day, each with a per-model usage breakdown.
export interface LangfuseDailyMetric {
  date: string;
  countTraces?: number | null;
  countObservations?: number | null;
  totalCost?: number | null;
  usage?: Array<{
    model?: string | null;
    inputUsage?: number | null;
    outputUsage?: number | null;
    totalUsage?: number | null;
    countObservations?: number | null;
    totalCost?: number | null;
  }>;
}

// GET /api/public/scores response row — a single eval/quality score attached to a trace.
export interface LangfuseScore {
  id: string;
  name?: string | null;
  value?: number | null;
  stringValue?: string | null;
  dataType?: string | null;
  timestamp?: string;
  traceId?: string | null;
  source?: string | null;
  comment?: string | null;
}

// Shaped cost/usage rollup for the Langfuse-sourced FinOps panel.
export interface LangfuseCostPoint {
  day: string; // YYYY-MM-DD
  cost: number;
  traces: number;
  tokens: number;
}
export interface LangfuseModelCost {
  model: string;
  cost: number;
  tokens: number;
}
export interface LangfuseCostSummary {
  totalCost: number;
  totalTokens: number;
  totalTraces: number;
  daily: LangfuseCostPoint[];
  byModel: LangfuseModelCost[];
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// Pure: shape the daily-metrics API rows into a cost summary (per-day series + per-model rollup).
// Zero network. Tolerant of nulls/missing fields — Langfuse omits usage on trace-only days.
export function shapeCostSummary(rows: LangfuseDailyMetric[]): LangfuseCostSummary {
  const daily: LangfuseCostPoint[] = [];
  const modelMap = new Map<string, LangfuseModelCost>();
  let totalCost = 0;
  let totalTokens = 0;
  let totalTraces = 0;

  // Oldest → newest so the series reads left-to-right in time.
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const row of sorted) {
    const usage = row.usage ?? [];
    let dayTokens = 0;
    for (const u of usage) {
      const model = u.model ?? 'unknown';
      const tokens = u.totalUsage ?? (u.inputUsage ?? 0) + (u.outputUsage ?? 0);
      const cost = u.totalCost ?? 0;
      dayTokens += tokens;
      const entry = modelMap.get(model) ?? { model, cost: 0, tokens: 0 };
      entry.cost += cost;
      entry.tokens += tokens;
      modelMap.set(model, entry);
    }
    const dayCost = row.totalCost ?? 0;
    const dayTraces = row.countTraces ?? 0;
    totalCost += dayCost;
    totalTokens += dayTokens;
    totalTraces += dayTraces;
    daily.push({ day: row.date, cost: round(dayCost), traces: dayTraces, tokens: dayTokens });
  }

  const byModel = [...modelMap.values()]
    .map((m) => ({ model: m.model, cost: round(m.cost), tokens: m.tokens }))
    .sort((a, b) => b.cost - a.cost);

  return { totalCost: round(totalCost), totalTokens, totalTraces, daily, byModel };
}

// Shaped score trend — per named metric, a time-ordered series + summary stats.
export interface ScoreTrendSeries {
  name: string;
  count: number;
  latest: number | null;
  average: number | null;
  points: Array<{ ts: string; value: number }>;
}

// Pure: group raw scores by name, keep only NUMERIC scores, order each series oldest→newest, and
// compute latest + average. Non-numeric (categorical/boolean-as-string) scores are excluded from
// the trend line (no meaningful numeric average). Zero network.
export function shapeScoreTrends(scores: LangfuseScore[]): ScoreTrendSeries[] {
  const byName = new Map<string, Array<{ ts: string; value: number }>>();
  for (const s of scores) {
    if (typeof s.value !== 'number' || Number.isNaN(s.value)) continue;
    const name = s.name ?? 'unnamed';
    const list = byName.get(name) ?? [];
    list.push({ ts: s.timestamp ?? '', value: s.value });
    byName.set(name, list);
  }
  return [...byName.entries()]
    .map(([name, pts]) => {
      const points = pts.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      const sum = points.reduce((acc, p) => acc + p.value, 0);
      return {
        name,
        count: points.length,
        latest: points.length ? points[points.length - 1].value : null,
        average: points.length ? round(sum / points.length) : null,
        points,
      };
    })
    .sort((a, b) => b.count - a.count);
}

// GET /api/public/metrics/daily — aggregated cost/usage per day over a window.
// fromIso/toIso are ISO strings; Langfuse filters traces whose timestamp is in range.
export async function fetchDailyMetrics(
  fromIso?: string,
  toIso?: string,
): Promise<LangfuseDailyMetric[]> {
  const qs = new URLSearchParams({ limit: '100' });
  if (fromIso) qs.set('fromTimestamp', fromIso);
  if (toIso) qs.set('toTimestamp', toIso);
  const json = await lfGet<Paged<LangfuseDailyMetric>>(`/api/public/metrics/daily?${qs.toString()}`);
  return json.data ?? [];
}

// GET /api/public/scores — eval/quality scores, filtered to a window.
export async function fetchScores(
  fromIso?: string,
  toIso?: string,
  limit = 100,
): Promise<LangfuseScore[]> {
  const qs = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
  if (fromIso) qs.set('fromTimestamp', fromIso);
  if (toIso) qs.set('toTimestamp', toIso);
  const json = await lfGet<Paged<LangfuseScore>>(`/api/public/scores?${qs.toString()}`);
  return json.data ?? [];
}

// URL-driven time range. `range` is a searchParams value like '7d' | '30d' | '90d'; default 7d.
// Pure: given a range token and a "now", return the ISO from/to window. Unknown tokens fall to 7d.
export const RANGE_DAYS: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
export const DEFAULT_RANGE = '7d';

export function resolveRange(
  range: string | undefined,
  now: Date = new Date(),
): { range: string; days: number; fromIso: string; toIso: string } {
  const key = range && range in RANGE_DAYS ? range : DEFAULT_RANGE;
  const days = RANGE_DAYS[key];
  const to = now;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { range: key, days, fromIso: from.toISOString(), toIso: to.toISOString() };
}

// Best-effort combined read-back for the page — never throws. Real zeros when unconfigured/unreachable.
export interface LangfuseInsights {
  configured: boolean;
  cost: LangfuseCostSummary;
  trends: ScoreTrendSeries[];
  error?: string;
}

const EMPTY_COST: LangfuseCostSummary = {
  totalCost: 0,
  totalTokens: 0,
  totalTraces: 0,
  daily: [],
  byModel: [],
};

export async function safeLangfuseInsights(
  fromIso?: string,
  toIso?: string,
): Promise<LangfuseInsights> {
  if (!langfuseReadConfigured()) return { configured: false, cost: EMPTY_COST, trends: [] };
  try {
    const [metrics, scores] = await Promise.all([
      fetchDailyMetrics(fromIso, toIso),
      fetchScores(fromIso, toIso),
    ]);
    return { configured: true, cost: shapeCostSummary(metrics), trends: shapeScoreTrends(scores) };
  } catch (e) {
    return { configured: true, cost: EMPTY_COST, trends: [], error: (e as Error).message };
  }
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
