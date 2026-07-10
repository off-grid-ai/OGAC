// Admission control — the backpressure guard on the SYNCHRONOUS request path.
//
// llama-server on a 16GB node serves largely sequentially; firing N concurrent
// requests at it doesn't parallelize — it inflates every request's latency and,
// past a point, exhausts the KV-cache (the "jam" that still answers /health).
// So we cap concurrency PER NODE and queue the overflow with a bounded, timed
// wait. When the queue is full we fast-reject with 503 + Retry-After — graceful
// backpressure to the caller instead of silently melting a node.
//
// This is deliberately in-process (no external dependency, no added hop): the
// hot chat path must stay fast. Durable, retryable QUEUED inference (batch,
// agents, long generations) belongs on Temporal — a separate async layer whose
// worker concurrency is its own backpressure — not here.

export interface LimiterConfig {
  /** Max requests a single node serves at once before overflow queues. */
  maxConcurrentPerNode: number;
  /** Max requests allowed to WAIT per node; beyond this we 503. */
  maxQueuePerNode: number;
  /** How long a queued request waits for a slot before giving up (ms). */
  acquireTimeoutMs: number;
}

export function limiterConfig(o: Partial<LimiterConfig> = {}): LimiterConfig {
  const n = (v: string | undefined, d: number): number => (v == null ? d : Number(v));
  return {
    maxConcurrentPerNode: o.maxConcurrentPerNode ?? n(process.env.OFFGRID_MAX_CONCURRENT_PER_NODE, 2),
    maxQueuePerNode: o.maxQueuePerNode ?? n(process.env.OFFGRID_MAX_QUEUE_PER_NODE, 24),
    acquireTimeoutMs: o.acquireTimeoutMs ?? n(process.env.OFFGRID_QUEUE_TIMEOUT_MS, 30000),
  };
}

/** Thrown/returned when a node is saturated and its wait-queue is full. */
export class Saturated extends Error {
  constructor(public readonly node: string) {
    super(`node ${node} saturated`);
    this.name = 'Saturated';
  }
}

interface NodeState {
  active: number;
  peak: number;
  waiters: { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }[];
}

export class AdmissionLimiter {
  private state: Record<string, NodeState> = {};

  constructor(private readonly cfg: LimiterConfig) {}

  private nodeState(name: string): NodeState {
    return (this.state[name] ||= { active: 0, peak: 0, waiters: [] });
  }

  /** Acquire a slot for a node. Resolves when a slot is free; rejects Saturated
   *  if the wait-queue is full or the wait times out. */
  acquire(name: string): Promise<void> {
    const s = this.nodeState(name);
    if (s.active < this.cfg.maxConcurrentPerNode) {
      s.active += 1;
      if (s.active > s.peak) s.peak = s.active;
      return Promise.resolve();
    }
    if (s.waiters.length >= this.cfg.maxQueuePerNode) return Promise.reject(new Saturated(name));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = s.waiters.findIndex((w) => w.timer === timer);
        if (i >= 0) s.waiters.splice(i, 1);
        reject(new Saturated(name));
      }, this.cfg.acquireTimeoutMs);
      timer.unref?.();
      s.waiters.push({ resolve, reject, timer });
    });
  }

  /** Release a slot; hands it to the next waiter if any. */
  release(name: string): void {
    const s = this.nodeState(name);
    const next = s.waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      // active stays the same (slot transfers to the waiter).
      if (s.active > s.peak) s.peak = s.active;
      next.resolve();
    } else {
      s.active = Math.max(0, s.active - 1);
    }
  }

  inflight(name: string): number {
    return this.state[name]?.active ?? 0;
  }

  queued(name: string): number {
    return this.state[name]?.waiters.length ?? 0;
  }

  peak(name: string): number {
    return this.state[name]?.peak ?? 0;
  }

  /** Total load signal for a node (in-flight + queued) — used for load-aware routing. */
  load(name: string): number {
    const s = this.state[name];
    return s ? s.active + s.waiters.length : 0;
  }
}
