// ─── Retrying a run-state write, and refusing to lose it quietly ──────────────────────────────────────
//
// `persistState` on the durable worker was:
//
//     try { await upsertAppRunState(...) } catch { /* DB unreachable — degrade to no-op */ }
//
// The comment is right that the workflow state is authoritative: the RUN is not lost. What is lost is the
// CONSOLE's view of it, and that is what every person and every audit reads. A completed run whose final
// write failed shows as whatever the last successful write said — stale, or missing entirely — with no
// error anywhere. It is the failure-presents-as-emptiness defect at the persistence layer, and the
// capability map records it as an open gap: "persistState still swallows database errors with no
// replay/backfill repair path".
//
// Two things change. A transient blip — the common case, a connection recycled mid-write — is RETRIED, so
// it stops being a lost write at all. A write that still fails is recorded loudly with the run id, because
// the only thing that makes it repairable is knowing which run to repair, and that cannot go in the
// database we just failed to reach.
//
// Pure. Zero IO.

/** Attempts, including the first. Small on purpose: an activity that retries for a minute blocks a run. */
export const MAX_PERSIST_ATTEMPTS = 3;

/**
 * How long to wait before attempt N+1, or null when there are no attempts left.
 *
 * Exponential from a short base: a recycled connection is usually usable on the next try, and the point is
 * to survive a blip without turning a slow database into a stalled run.
 */
export function persistBackoffMs(attempt: number, baseMs = 120): number | null {
  if (attempt < 1 || attempt >= MAX_PERSIST_ATTEMPTS) return null;
  return baseMs * 2 ** (attempt - 1);
}

/**
 * The line an operator needs when a run's state could not be written.
 *
 * Carries the run id, the org and the attempt count, because the repair is "re-persist THIS run" and a
 * message without the id is an alarm nobody can act on. Prefixed so it can be grepped out of the worker
 * log, which is the one place that still works when the database does not.
 */
export function describePersistFailure(input: {
  runId: string;
  orgId: string;
  attempts: number;
  status?: string;
  error: unknown;
}): string {
  const reason =
    input.error instanceof Error
      ? // The CAUSE is where the real diagnosis lives on database errors — a bare message reads
        // "Failed query" and says nothing about why.
        `${input.error.message}${(input.error as { cause?: { code?: string } }).cause?.code ? ` (cause ${(input.error as { cause?: { code?: string } }).cause?.code})` : ''}`
      : String(input.error);
  return [
    'APP_RUN_PERSIST_FAILED',
    `run=${input.runId}`,
    `org=${input.orgId}`,
    `status=${input.status ?? 'unknown'}`,
    `attempts=${input.attempts}`,
    `reason=${reason}`,
    '— the workflow state is authoritative; this run needs re-persisting before the console shows it correctly',
  ].join(' ');
}

/** True when the run had reached a terminal state, so a lost write leaves a permanently wrong record. */
export function isTerminalStatus(status: string | undefined): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}
