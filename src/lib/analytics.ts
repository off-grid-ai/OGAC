import { type AuditEvent, listAudit } from '@/lib/store';

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
  const events = await listAudit({ limit: 5000 });
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
