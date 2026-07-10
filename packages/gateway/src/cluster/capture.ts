// Traffic capture: a bounded rolling in-memory log of proxied calls + per-node
// counters (read by health derivation and the live /traffic view), plus a
// fan-out to any number of pluggable ObservabilitySink adapters. The in-memory
// state is always kept; where records additionally go (OpenSearch, Langfuse,
// stdout, custom) is entirely up to the injected sinks. Sinks never block or
// fail a request.
import type { ObservabilitySink } from './observability';
import type { NodeStats, TrafficRecord } from './types';

const LOG_MAX = 2000; // enough recent history to power analytics/finops rollups in the dashboard

export class TrafficStore {
  readonly startedAt = Date.now();
  private log: TrafficRecord[] = [];
  private stats: Record<string, { requests: number; errors: number; totalMs: number; tokens: number }> = {};

  constructor(private readonly sinks: ObservabilitySink[] = []) {}

  record(e: TrafficRecord): void {
    this.log.push(e);
    if (this.log.length > LOG_MAX) this.log.shift();
    const s = (this.stats[e.gateway] ||= { requests: 0, errors: 0, totalMs: 0, tokens: 0 });
    s.requests += 1;
    if (!e.status || e.status >= 400) s.errors += 1;
    s.totalMs += e.ms;
    if (e.tokens) s.tokens += e.tokens;
    for (const sink of this.sinks) {
      try {
        sink.record(e);
      } catch {
        /* a broken sink never affects the request path */
      }
    }
  }

  /** Records within the recency window for a node (health derivation reads this). */
  recentFor(name: string, windowMs: number, now = Date.now()): TrafficRecord[] {
    return this.log.filter((e) => e.gateway === name && now - e.ts <= windowMs);
  }

  counters(name: string): { requests: number; errors: number; totalMs: number; tokens: number } {
    return this.stats[name] || { requests: 0, errors: 0, totalMs: 0, tokens: 0 };
  }

  statsFor(
    name: string,
    model: string,
    health: NodeStats['health'],
    gauges: { inflight: number; queued: number; peakInflight: number } = { inflight: 0, queued: 0, peakInflight: 0 },
  ): NodeStats {
    const s = this.counters(name);
    return {
      gateway: name,
      model,
      requests: s.requests,
      errors: s.errors,
      totalMs: s.totalMs,
      tokens: s.tokens,
      avgMs: s.requests ? Math.round(s.totalMs / s.requests) : 0,
      health,
      inflight: gauges.inflight,
      queued: gauges.queued,
      peakInflight: gauges.peakInflight,
    };
  }

  /** Newest-first copy of the rolling log. */
  recent(): TrafficRecord[] {
    return this.log.slice().reverse();
  }
}
