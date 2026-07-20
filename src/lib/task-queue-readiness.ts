// ─── Pure decisions for TEMPORAL TASK-QUEUE READINESS ────────────────────────────────────────────
//
// Zero-import, zero-I/O, unit-testable shaping of a Temporal `DescribeTaskQueue` response into the
// operator-facing readiness contract for a durable worker queue. This is the pure core behind the
// `temporal:worker-readiness` and `app-worker:task-queue-readiness` capabilities: whether a
// COMPATIBLE poller is actually draining a queue must be PROVEN from live poller evidence, never
// inferred from Temporal availability or an eventual run state.
//
// The adapter (adapters/worker-readiness.ts) does the gRPC call and hands the raw response here; the
// route/UI render the result. Keeping the decision pure makes "is this queue ready?" testable
// without a live cluster.

/** One poller Temporal reports as currently polling a task queue. */
export interface RawPoller {
  identity?: string | null;
  /** Temporal returns a Date (SDK) or ISO string; we normalize both. */
  lastAccessTime?: Date | string | number | null;
  ratePerSecond?: number | null;
}

/** The subset of a `DescribeTaskQueue` response this contract depends on. */
export interface RawTaskQueueDescription {
  pollers?: readonly RawPoller[] | null;
  /** Optional backlog count from the enhanced/stats API; absent on the basic describe. */
  backlogCount?: number | null;
}

/** How the readiness read resolved for one queue. */
export type QueueReadinessStatus = 'ready' | 'no-pollers' | 'unreachable' | 'not-configured';

/** A normalized poller for display. */
export interface PollerView {
  identity: string;
  lastAccessTime: string | null;
  ratePerSecond: number | null;
}

/** The readiness verdict for a single durable task queue. */
export interface QueueReadiness {
  queue: string;
  status: QueueReadinessStatus;
  /** Number of compatible pollers currently attached to the queue. */
  pollerCount: number;
  pollers: readonly PollerView[];
  /** Backlog of unstarted tasks, when the stats API supplied it; null when unknown. */
  backlogCount: number | null;
  /** Human-readable evidence line for the operator and audit. */
  note: string;
}

/** Roll-up across every durable queue the platform depends on. */
export interface WorkerReadinessSummary {
  queues: readonly QueueReadiness[];
  /** Every queue has at least one compatible poller. */
  allReady: boolean;
  readyCount: number;
  totalCount: number;
}

function normalizeAccessTime(value: RawPoller['lastAccessTime']): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(value).trim();
  return s === '' ? null : s;
}

function normalizeRate(value: RawPoller['ratePerSecond']): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizePoller(raw: RawPoller): PollerView | null {
  const identity = String(raw.identity ?? '').trim();
  if (identity === '') return null; // an identityless poller entry is not usable evidence
  return {
    identity,
    lastAccessTime: normalizeAccessTime(raw.lastAccessTime),
    ratePerSecond: normalizeRate(raw.ratePerSecond),
  };
}

function normalizeBacklog(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/**
 * Shape one queue's readiness from a raw `DescribeTaskQueue` response.
 *
 * - `raw === null` with `configured: false` → `not-configured` (durable path off; not a failure).
 * - `raw === null` with `configured: true` → `unreachable` (the probe threw / cluster down).
 * - `raw` present, ≥1 identified poller → `ready`.
 * - `raw` present, zero pollers → `no-pollers` (queue exists but nothing is draining it).
 */
export function shapeQueueReadiness(
  queue: string,
  raw: RawTaskQueueDescription | null,
  opts: { configured: boolean; note?: string } = { configured: true },
): QueueReadiness {
  const name = queue.trim() || 'unknown';
  if (raw === null) {
    const status: QueueReadinessStatus = opts.configured ? 'unreachable' : 'not-configured';
    return {
      queue: name,
      status,
      pollerCount: 0,
      pollers: [],
      backlogCount: null,
      note:
        opts.note ??
        (opts.configured
          ? 'Temporal was unreachable; poller readiness could not be verified.'
          : 'Durable runtime is not configured; no queue to poll.'),
    };
  }
  const pollers = (raw.pollers ?? [])
    .map(normalizePoller)
    .filter((p): p is PollerView => p !== null);
  const backlogCount = normalizeBacklog(raw.backlogCount);
  const ready = pollers.length > 0;
  const backlogNote = backlogCount === null ? '' : ` Backlog ${backlogCount}.`;
  return {
    queue: name,
    status: ready ? 'ready' : 'no-pollers',
    pollerCount: pollers.length,
    pollers,
    backlogCount,
    note: ready
      ? `${pollers.length} compatible poller${pollers.length === 1 ? '' : 's'}: ${pollers
          .map((p) => p.identity)
          .join(', ')}.${backlogNote}`
      : `Queue "${name}" has no compatible poller; durable work would not drain.${backlogNote}`,
  };
}

/** Roll up per-queue readiness into the overall worker-readiness contract. */
export function summarizeWorkerReadiness(
  queues: readonly QueueReadiness[],
): WorkerReadinessSummary {
  const readyCount = queues.filter((q) => q.status === 'ready').length;
  return {
    queues,
    readyCount,
    totalCount: queues.length,
    allReady: queues.length > 0 && readyCount === queues.length,
  };
}
