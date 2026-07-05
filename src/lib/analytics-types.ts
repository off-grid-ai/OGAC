// Shared analytics result types. Kept in their own zero-import module so the PURE aggregation
// logic (analytics-aggs.ts) and the I/O adapter (analytics.ts) can both reference them without a
// circular import. analytics.ts re-exports these so existing `@/lib/analytics` importers are
// unchanged.
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
