// @offgrid/finops — spend accumulation store.

import type { ObservabilitySink, TrafficRecord } from './gateway-types.js';
import { costOf, type ModelPrice, PRICING } from './pricing.js';

interface Entry {
  ts: number;
  model: string;
  caller: string;
  gateway: string;
  usd: number;
  tokens: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Totals {
  totalUsd: number;
  totalTokens: number;
  requests: number;
}

export interface DailySpend {
  day: string; // YYYY-MM-DD (UTC)
  usd: number;
  tokens: number;
  requests: number;
}

export class FinopsStore {
  private entries: Entry[] = [];
  private pricing: Record<string, ModelPrice>;

  constructor(pricing: Record<string, ModelPrice> = PRICING) {
    this.pricing = pricing;
  }

  ingest(e: TrafficRecord): void {
    const cost = costOf(e, this.pricing);
    this.entries.push({
      ts: e.ts,
      model: e.modelServed ?? e.model,
      caller: e.caller ?? 'unknown',
      gateway: e.gateway,
      usd: cost.total,
      tokens: e.tokens,
    });
  }

  private groupBy(key: (e: Entry) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries) out[key(e)] = (out[key(e)] ?? 0) + e.usd;
    return out;
  }

  spendByModel(): Record<string, number> {
    return this.groupBy((e) => e.model);
  }

  spendByCaller(): Record<string, number> {
    return this.groupBy((e) => e.caller);
  }

  spendByGateway(): Record<string, number> {
    return this.groupBy((e) => e.gateway);
  }

  /** Spend for the trailing `days` (default 30), one bucket per UTC day. */
  dailySpend(days = 30): DailySpend[] {
    const now = Date.now();
    const cutoff = now - days * DAY_MS;
    const buckets = new Map<string, DailySpend>();
    for (const e of this.entries) {
      if (e.ts < cutoff) continue;
      const day = new Date(e.ts).toISOString().slice(0, 10);
      let b = buckets.get(day);
      if (!b) {
        b = { day, usd: 0, tokens: 0, requests: 0 };
        buckets.set(day, b);
      }
      b.usd += e.usd;
      b.tokens += e.tokens;
      b.requests += 1;
    }
    return [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  /** Extrapolate a 30-day spend from the trailing `windowDays` (default 7). */
  projectedMonthlyUsd(windowDays = 7): number {
    const now = Date.now();
    const cutoff = now - windowDays * DAY_MS;
    let usd = 0;
    for (const e of this.entries) if (e.ts >= cutoff) usd += e.usd;
    if (usd === 0) return 0;
    return (usd / windowDays) * 30;
  }

  /** Accumulated spend for a single caller (all time). */
  spendForCaller(caller: string): number {
    let usd = 0;
    for (const e of this.entries) if (e.caller === caller) usd += e.usd;
    return usd;
  }

  totals(): Totals {
    let totalUsd = 0;
    let totalTokens = 0;
    for (const e of this.entries) {
      totalUsd += e.usd;
      totalTokens += e.tokens;
    }
    return { totalUsd, totalTokens, requests: this.entries.length };
  }
}

export function finopsSink(store: FinopsStore): ObservabilitySink {
  return { name: 'finops', record: (e) => store.ingest(e) };
}
