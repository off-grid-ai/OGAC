import { type AuditEvent } from '@/lib/store';

// Analytics now reads REAL gateway traffic from OpenSearch (index offgrid-gateway — the same
// durable sink the gateway usage/logs views use), NOT the seeded Postgres audit table. Empty or
// unreachable → real zeros, never synthetic. Each gateway record is mapped to the AuditEvent
// shape so the existing rollups (byModel/series/percentiles/drift) work unchanged.
const OS_URL = process.env.OFFGRID_OPENSEARCH_URL ?? 'http://offgrid-s1.local:9200';
const OS_INDEX = process.env.OFFGRID_GATEWAY_INDEX ?? 'offgrid-gateway';

export async function gatewayEvents(): Promise<AuditEvent[]> {
  try {
    const r = await fetch(`${OS_URL}/${OS_INDEX}/_search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ size: 5000, sort: [{ '@timestamp': 'desc' }], query: { match_all: {} } }),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    const hits: { _id?: string; _source?: Record<string, unknown> }[] = data?.hits?.hits ?? [];
    return hits.map((h, i) => {
      const s = h._source ?? {};
      const status = Number(s.status ?? 200);
      return {
        id: h._id ?? String(i),
        deviceId: String(s.caller ?? s.gateway ?? ''),
        ts: String(s['@timestamp'] ?? new Date(Number(s.ts ?? Date.now())).toISOString()),
        model: String(s.model ?? 'unknown'),
        tokens: Number(s.tokens ?? 0),
        leftDevice: false,
        tool: null,
        outcome: status >= 400 ? 'blocked' : 'ok',
        latencyMs: Number(s.ms ?? 0),
        keyId: null,
      } satisfies AuditEvent;
    });
  } catch {
    return [];
  }
}

export interface ModelStat {
  model: string;
  events: number;
  tokens: number;
  avgLatency: number;
}

export interface DayPoint {
  day: string;
  events: number;
  avgLatency: number;
}

export interface Signal {
  recent: number;
  baseline: number;
  flagged: boolean;
}

export interface Analytics {
  totalEvents: number;
  totalTokens: number;
  p50: number;
  p95: number;
  egressRate: number;
  outcomes: { ok: number; redacted: number; blocked: number };
  byModel: ModelStat[];
  series: DayPoint[];
  drift: Signal;
  perf: Signal;
}

const DRIFT_FACTOR = 1.5;
const PERF_FACTOR = 1.3;
const RECENT_MS = 2 * 86_400_000;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}

function blockedRate(events: AuditEvent[]): number {
  if (events.length === 0) return 0;
  const flagged = events.filter((e) => e.outcome === 'blocked' || e.outcome === 'redacted').length;
  return flagged / events.length;
}

function byModel(events: AuditEvent[]): ModelStat[] {
  const map = new Map<string, { events: number; tokens: number; latency: number }>();
  for (const e of events) {
    const m = map.get(e.model) ?? { events: 0, tokens: 0, latency: 0 };
    m.events += 1;
    m.tokens += e.tokens;
    m.latency += e.latencyMs ?? 0;
    map.set(e.model, m);
  }
  return [...map.entries()]
    .map(([model, v]) => ({
      model,
      events: v.events,
      tokens: v.tokens,
      avgLatency: Math.round(v.latency / v.events),
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

function series(events: AuditEvent[]): DayPoint[] {
  const map = new Map<string, { events: number; latency: number }>();
  for (const e of events) {
    const day = e.ts.slice(0, 10);
    const d = map.get(day) ?? { events: 0, latency: 0 };
    d.events += 1;
    d.latency += e.latencyMs ?? 0;
    map.set(day, d);
  }
  return [...map.entries()]
    .map(([day, v]) => ({ day, events: v.events, avgLatency: Math.round(v.latency / v.events) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export async function computeAnalytics(): Promise<Analytics> {
  const events = await gatewayEvents();
  const now = Date.now();
  const recent = events.filter((e) => now - new Date(e.ts).getTime() < RECENT_MS);
  const baseline = events.filter((e) => now - new Date(e.ts).getTime() >= RECENT_MS);
  const lat = events.map((e) => e.latencyMs ?? 0);

  const recentBlocked = Number(blockedRate(recent).toFixed(3));
  const baseBlocked = Number(blockedRate(baseline).toFixed(3));
  const recentP95 = percentile(
    recent.map((e) => e.latencyMs ?? 0),
    0.95,
  );
  const baseP95 = percentile(
    baseline.map((e) => e.latencyMs ?? 0),
    0.95,
  );

  return {
    totalEvents: events.length,
    totalTokens: events.reduce((a, e) => a + e.tokens, 0),
    p50: percentile(lat, 0.5),
    p95: percentile(lat, 0.95),
    egressRate: Number(
      ((events.filter((e) => e.leftDevice).length / (events.length || 1)) * 100).toFixed(1),
    ),
    outcomes: {
      ok: events.filter((e) => e.outcome === 'ok').length,
      redacted: events.filter((e) => e.outcome === 'redacted').length,
      blocked: events.filter((e) => e.outcome === 'blocked').length,
    },
    byModel: byModel(events),
    series: series(events),
    drift: {
      recent: recentBlocked,
      baseline: baseBlocked,
      flagged: recentBlocked > baseBlocked * DRIFT_FACTOR,
    },
    perf: { recent: recentP95, baseline: baseP95, flagged: recentP95 > baseP95 * PERF_FACTOR },
  };
}
