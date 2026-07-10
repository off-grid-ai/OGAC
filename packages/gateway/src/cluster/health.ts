// TRUE inference health, not just "the process answers /health".
//
// A jammed node (KV-cache exhausted) still answers /health but times out or
// errors on generation — so process-reachability alone lies. We fold three
// cheap signals together: process reachability, recent error rate, and recent
// average latency (jams show up as very slow / timing-out generations), plus an
// optional bounded 1-token probe that catches jams even with zero live traffic.
//
// NOTE on latency: we compare in MILLISECONDS. A fast probe (a few hundred ms)
// is HEALTHY — only tens of seconds means a stall. Rounding latency to whole
// seconds and treating 0 as "jammed" is a bug; this module never does that.
import type { TrafficStore } from './capture';
import type { GatewayNode, Health, HealthConfig } from './types';

export function healthConfig(o: Partial<HealthConfig> = {}): HealthConfig {
  const n = (v: string | undefined, d: number): number => (v == null ? d : Number(v));
  return {
    windowMs: o.windowMs ?? n(process.env.OFFGRID_HEALTH_WINDOW_MS, 120000),
    slowMs: o.slowMs ?? n(process.env.OFFGRID_HEALTH_SLOW_MS, 30000),
    jamMs: o.jamMs ?? n(process.env.OFFGRID_HEALTH_JAM_MS, 90000),
    degradedErrRate: o.degradedErrRate ?? n(process.env.OFFGRID_HEALTH_ERR_RATE, 0.25),
    downErrRate: o.downErrRate ?? n(process.env.OFFGRID_HEALTH_DOWN_ERR_RATE, 0.6),
    probeEnabled: o.probeEnabled ?? process.env.OFFGRID_HEALTH_PROBE !== '0',
    probeEveryMs: o.probeEveryMs ?? n(process.env.OFFGRID_HEALTH_PROBE_MS, 60000),
    probeTimeoutMs: o.probeTimeoutMs ?? n(process.env.OFFGRID_HEALTH_PROBE_TIMEOUT_MS, 8000),
  };
}

interface Probe {
  reachable: boolean;
  genOk: boolean | null;
  genMs: number | null;
  ts: number;
}

export class HealthMonitor {
  private probe: Record<string, Probe> = {};
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly traffic: TrafficStore,
    private readonly cfg: HealthConfig,
  ) {}

  /** Seed reachability from a cheap liveness check so health isn't 'unknown' on cold start. */
  seed(name: string, reachable: boolean): void {
    if (!this.probe[name]) this.probe[name] = { reachable, genOk: null, genMs: null, ts: Date.now() };
  }

  // eslint-disable-next-line complexity
  healthFor(name: string): Health {
    const now = Date.now();
    const recent = this.traffic.recentFor(name, this.cfg.windowMs, now);
    const p = this.probe[name];
    const probeFresh = p && now - p.ts <= this.cfg.windowMs;

    // Process unreachable (and no successful recent traffic contradicts it) ⇒ down.
    if (probeFresh && !p.reachable && !recent.some((e) => e.status && e.status < 400)) return 'down';

    const errs = recent.filter((e) => !e.status || e.status >= 400).length;
    const errRate = recent.length ? errs / recent.length : 0;
    const avgMs = recent.length ? recent.reduce((a, e) => a + (e.ms || 0), 0) / recent.length : 0;

    // Probe reached the process but a bounded 1-token generation failed or crawled ⇒ jammed.
    if (probeFresh && p.reachable && p.genOk === false) return 'down';
    if (probeFresh && p.reachable && p.genMs != null && p.genMs >= this.cfg.slowMs) return 'degraded';

    if (recent.length >= 2) {
      if (errRate >= this.cfg.downErrRate || avgMs >= this.cfg.jamMs) return 'down';
      if (errRate >= this.cfg.degradedErrRate || avgMs >= this.cfg.slowMs) return 'degraded';
    }
    if (probeFresh && p.reachable) return 'up';
    if (recent.some((e) => e.status && e.status < 400)) return 'up';
    return probeFresh ? 'up' : 'unknown';
  }

  private async probeOne(g: GatewayNode): Promise<void> {
    const started = Date.now();
    try {
      const h = await fetch(`http://${g.host}:${g.port}/health`, { signal: AbortSignal.timeout(2000) }).catch(
        () => null,
      );
      const reachable = !!(h && h.ok);
      if (!reachable) {
        this.probe[g.name] = { reachable: false, genOk: null, genMs: null, ts: Date.now() };
        return;
      }
      const genStart = Date.now();
      const r = await fetch(`http://${g.host}:${g.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: g.model, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
        signal: AbortSignal.timeout(this.cfg.probeTimeoutMs),
      }).catch(() => null);
      this.probe[g.name] = { reachable: true, genOk: !!(r && r.ok), genMs: Date.now() - genStart, ts: Date.now() };
    } catch {
      this.probe[g.name] = { reachable: false, genOk: false, genMs: Date.now() - started, ts: Date.now() };
    }
  }

  /** Start staggered background probing across the live nodes (one per tick). */
  start(live: GatewayNode[]): void {
    if (!this.cfg.probeEnabled || this.timer) return;
    let i = 0;
    const stagger = Math.max(500, Math.floor(this.cfg.probeEveryMs / Math.max(1, live.length)));
    this.timer = setInterval(() => {
      const g = live[i++ % live.length];
      if (g) void this.probeOne(g);
    }, stagger);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
