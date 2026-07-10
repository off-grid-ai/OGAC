// @offgrid/analytics — store
//
// AnalyticsStore: an in-memory, bounded, rolling store of gateway traffic.
// It keeps a ring buffer of the most recent records for time-window queries,
// plus pre-aggregated counters so top-level totals/rollups stay O(1) to read
// regardless of how many records have flowed through.

import type { TrafficRecord } from './gateway-types.js';

/** Aggregate totals across every ingested record. */
export interface Totals {
  requests: number;
  errors: number;
  errorRate: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  avgMs: number;
  avgTps: number;
}

/** One row of a grouped rollup (by model / caller / gateway). */
export interface GroupRow {
  /** Group key. Named `model` on byModel(); reused generically elsewhere. */
  model: string;
  requests: number;
  tokens: number;
  avgMs: number;
  errorRate: number;
}

/** One time bucket of the timeseries. */
export interface TimeBucket {
  /** Bucket start, epoch ms (aligned to bucketMs). */
  t: number;
  requests: number;
  tokens: number;
  errors: number;
  avgMs: number;
}

/** A recent distinct prompt with an occurrence count. */
export interface PromptCount {
  input: string;
  count: number;
  /** Most recent time this input was seen (epoch ms). */
  lastTs: number;
}

/** Mutable accumulator used internally per group. */
interface GroupAcc {
  requests: number;
  errors: number;
  tokens: number;
  msSum: number;
}

const DEFAULT_MAX_RECORDS = 10_000;

function emptyAcc(): GroupAcc {
  return { requests: 0, errors: 0, tokens: 0, msSum: 0 };
}

function accToRow(key: string, a: GroupAcc): GroupRow {
  return {
    model: key,
    requests: a.requests,
    tokens: a.tokens,
    avgMs: a.requests ? a.msSum / a.requests : 0,
    errorRate: a.requests ? a.errors / a.requests : 0,
  };
}

function rowsSortedByRequests(map: Map<string, GroupAcc>): GroupRow[] {
  return [...map.entries()]
    .map(([k, a]) => accToRow(k, a))
    .sort((x, y) => y.requests - x.requests);
}

export class AnalyticsStore {
  private readonly maxRecords: number;
  /** Ring buffer of recent records (bounded by maxRecords). */
  private readonly buf: TrafficRecord[] = [];
  /** Write cursor into `buf` once it has reached capacity. */
  private head = 0;

  // Pre-aggregated global counters (never evicted).
  private requests = 0;
  private errors = 0;
  private tokens = 0;
  private promptTokens = 0;
  private completionTokens = 0;
  private msSum = 0;
  private tpsSum = 0;
  private tpsCount = 0;

  // Pre-aggregated group counters (never evicted).
  private readonly models = new Map<string, GroupAcc>();
  private readonly callers = new Map<string, GroupAcc>();
  private readonly gateways = new Map<string, GroupAcc>();

  constructor(opts: { maxRecords?: number } = {}) {
    this.maxRecords = Math.max(1, opts.maxRecords ?? DEFAULT_MAX_RECORDS);
  }

  /** Ingest one completed traffic record. Never throws. */
  ingest(e: TrafficRecord): void {
    // Ring-buffer append.
    if (this.buf.length < this.maxRecords) {
      this.buf.push(e);
    } else {
      this.buf[this.head] = e;
      this.head = (this.head + 1) % this.maxRecords;
    }

    // Global counters.
    const isErr = e.status >= 400;
    this.requests += 1;
    if (isErr) this.errors += 1;
    this.tokens += e.tokens || 0;
    this.promptTokens += e.promptTokens ?? 0;
    this.completionTokens += e.completionTokens ?? 0;
    this.msSum += e.ms || 0;
    if (typeof e.tps === 'number' && e.tps > 0) {
      this.tpsSum += e.tps;
      this.tpsCount += 1;
    }

    // Group counters.
    this.bump(this.models, e.modelServed || e.model || 'unknown', e, isErr);
    this.bump(this.callers, e.caller || 'unknown', e, isErr);
    this.bump(this.gateways, e.gateway || 'unknown', e, isErr);
  }

  private bump(map: Map<string, GroupAcc>, key: string, e: TrafficRecord, isErr: boolean): void {
    let a = map.get(key);
    if (!a) {
      a = emptyAcc();
      map.set(key, a);
    }
    a.requests += 1;
    if (isErr) a.errors += 1;
    a.tokens += e.tokens || 0;
    a.msSum += e.ms || 0;
  }

  totals(): Totals {
    return {
      requests: this.requests,
      errors: this.errors,
      errorRate: this.requests ? this.errors / this.requests : 0,
      tokens: this.tokens,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      avgMs: this.requests ? this.msSum / this.requests : 0,
      avgTps: this.tpsCount ? this.tpsSum / this.tpsCount : 0,
    };
  }

  byModel(): GroupRow[] {
    return rowsSortedByRequests(this.models);
  }

  byCaller(): GroupRow[] {
    return rowsSortedByRequests(this.callers);
  }

  byGateway(): GroupRow[] {
    return rowsSortedByRequests(this.gateways);
  }

  /**
   * Bucketed timeseries built from the retained ring buffer.
   * @param bucketMs bucket width in ms
   * @param sinceMs  optional lower bound (epoch ms); records older are ignored
   */
  timeseries(bucketMs: number, sinceMs?: number): TimeBucket[] {
    const width = Math.max(1, Math.floor(bucketMs));
    const buckets = new Map<number, TimeBucket & { msSum: number }>();

    for (const e of this.buf) {
      if (sinceMs !== undefined && e.ts < sinceMs) continue;
      const t = Math.floor(e.ts / width) * width;
      let b = buckets.get(t);
      if (!b) {
        b = { t, requests: 0, tokens: 0, errors: 0, avgMs: 0, msSum: 0 };
        buckets.set(t, b);
      }
      b.requests += 1;
      b.tokens += e.tokens || 0;
      if (e.status >= 400) b.errors += 1;
      b.msSum += e.ms || 0;
    }

    return [...buckets.values()]
      .sort((a, b) => a.t - b.t)
      .map(({ msSum, ...rest }) => ({
        ...rest,
        avgMs: rest.requests ? msSum / rest.requests : 0,
      }));
  }

  /**
   * Best-effort: most frequent recent distinct inputs from the ring buffer.
   * Only records that carried an `input` are considered.
   */
  topPrompts(n = 10): PromptCount[] {
    const counts = new Map<string, PromptCount>();
    for (const e of this.buf) {
      const input = e.input;
      if (!input) continue;
      const c = counts.get(input);
      if (c) {
        c.count += 1;
        if (e.ts > c.lastTs) c.lastTs = e.ts;
      } else {
        counts.set(input, { input, count: 1, lastTs: e.ts });
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs)
      .slice(0, Math.max(0, n));
  }
}
