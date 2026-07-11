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
        latest: points.length ? points.at(-1)!.value : null,
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

// ── Prompt registry / datasets / sessions read-back ────────────────────────────────────────────
// Langfuse also serves the prompt registry, datasets (golden-set inputs/expected), and sessions
// (grouped multi-turn traces) over its public API. The console read only traces/cost/scores; these
// close that gap as pure READ-BACK. Each has: a raw API-shape interface, a pure shaper (unit-tested
// against representative JSON), a thin fetcher, and a best-effort safe wrapper that never throws.

// GET /api/public/v2/prompts — the prompt registry. The list endpoint returns one meta row per
// prompt NAME (latest version + labels), not the prompt body — that's the registry index view.
export interface LangfusePromptMeta {
  name?: string | null;
  versions?: number[] | null;
  labels?: string[] | null;
  tags?: string[] | null;
  lastUpdatedAt?: string | null;
  lastConfig?: unknown;
}

export interface PromptRow {
  name: string;
  latestVersion: number | null;
  versionCount: number;
  labels: string[];
  tags: string[];
  updatedAt: string;
}

// Pure: shape prompt-registry rows into a stable display model, newest-updated first. Tolerant of
// nulls — Langfuse omits labels/tags on bare prompts. `latestVersion` is the max version number.
export function shapePrompts(rows: LangfusePromptMeta[]): PromptRow[] {
  return rows
    .map((r) => {
      const versions = (r.versions ?? []).filter((v): v is number => typeof v === 'number');
      return {
        name: (r.name ?? '').trim() || 'unnamed',
        latestVersion: versions.length ? Math.max(...versions) : null,
        versionCount: versions.length,
        labels: (r.labels ?? []).filter((l): l is string => typeof l === 'string'),
        tags: (r.tags ?? []).filter((t): t is string => typeof t === 'string'),
        updatedAt: (r.lastUpdatedAt ?? '').trim(),
      };
    })
    .sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.name.localeCompare(b.name),
    );
}

// GET /api/public/datasets — dataset definitions (each groups items = input/expected pairs).
export interface LangfuseDataset {
  name?: string | null;
  description?: string | null;
  metadata?: unknown;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface DatasetRow {
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

// Pure: shape dataset rows, newest-created first. Description is best-effort text.
export function shapeDatasets(rows: LangfuseDataset[]): DatasetRow[] {
  return rows
    .map((r) => ({
      name: (r.name ?? '').trim() || 'unnamed',
      description: (r.description ?? '').trim(),
      createdAt: (r.createdAt ?? '').trim(),
      updatedAt: (r.updatedAt ?? '').trim(),
    }))
    .sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.name.localeCompare(b.name),
    );
}

// GET /api/public/sessions — sessions group related traces (a multi-turn conversation / run chain).
export interface LangfuseSession {
  id?: string | null;
  createdAt?: string | null;
  projectId?: string | null;
  countTraces?: number | null;
  traceCount?: number | null; // some API versions use this key
}

export interface SessionRow {
  id: string;
  createdAt: string;
  traces: number;
}

// Pure: shape session rows, newest-created first. Trace count reads either key the API emits.
export function shapeSessions(rows: LangfuseSession[]): SessionRow[] {
  return rows
    .map((r) => ({
      id: (r.id ?? '').trim() || 'unknown',
      createdAt: (r.createdAt ?? '').trim(),
      traces: r.countTraces ?? r.traceCount ?? 0,
    }))
    .sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id.localeCompare(b.id),
    );
}

// Thin fetchers.
export async function fetchPrompts(limit = 50): Promise<LangfusePromptMeta[]> {
  const json = await lfGet<Paged<LangfusePromptMeta>>(
    `/api/public/v2/prompts?limit=${Math.min(limit, 100)}`,
  );
  return json.data ?? [];
}

export async function fetchDatasets(limit = 50): Promise<LangfuseDataset[]> {
  const json = await lfGet<Paged<LangfuseDataset>>(
    `/api/public/datasets?limit=${Math.min(limit, 100)}`,
  );
  return json.data ?? [];
}

export async function fetchSessions(limit = 50): Promise<LangfuseSession[]> {
  const json = await lfGet<Paged<LangfuseSession>>(
    `/api/public/sessions?limit=${Math.min(limit, 100)}`,
  );
  return json.data ?? [];
}

// Best-effort combined read-back for the page — never throws. Real empties when unconfigured/unreachable.
// Each source is fetched independently (Promise.allSettled) so one failing endpoint (e.g. an older
// Langfuse without /v2/prompts) doesn't blank the others.
export interface LangfuseRegistry {
  configured: boolean;
  prompts: PromptRow[];
  datasets: DatasetRow[];
  sessions: SessionRow[];
  error?: string;
}

export async function safeLangfuseRegistry(limit = 50): Promise<LangfuseRegistry> {
  if (!langfuseReadConfigured())
    return { configured: false, prompts: [], datasets: [], sessions: [] };
  const [p, d, s] = await Promise.allSettled([
    fetchPrompts(limit),
    fetchDatasets(limit),
    fetchSessions(limit),
  ]);
  const errors: string[] = [];
  for (const r of [p, d, s]) if (r.status === 'rejected') errors.push((r.reason as Error).message);
  return {
    configured: true,
    prompts: p.status === 'fulfilled' ? shapePrompts(p.value) : [],
    datasets: d.status === 'fulfilled' ? shapeDatasets(d.value) : [],
    sessions: s.status === 'fulfilled' ? shapeSessions(s.value) : [],
    error: errors.length ? [...new Set(errors)].join('; ') : undefined,
  };
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
