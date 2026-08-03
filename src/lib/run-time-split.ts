// ─── Working time vs waiting time ────────────────────────────────────────────────────────────────────
//
// "Usually takes" read "—" on the app page and "Avg duration —" on Reports, and where a duration did
// compute it averaged 62,396 seconds — 17 hours — because the clock ran while a case sat in somebody's
// queue overnight. Both numbers are useless to the person who wants to know whether this saves them
// time: the machine did four minutes of work and then waited a day for a human, and one number cannot
// say that.
//
// So the two are separated. Pure. Zero IO.

export interface TimedStep {
  kind?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface TimeSplit {
  /** Time the system was actually doing something, ms. Null when no step carried timestamps. */
  workingMs: number | null;
  /** Time the case sat waiting on a person, ms. Null when unknown; 0 when it never waited. */
  waitingMs: number | null;
  /** Start to finish, ms. Null when either end is missing. */
  wallMs: number | null;
}

function span(s: TimedStep): number | null {
  if (!s.startedAt || !s.finishedAt) return null;
  const a = Date.parse(s.startedAt);
  const b = Date.parse(s.finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

/**
 * Split one run's elapsed time into work and waiting.
 *
 * Human steps are the waiting; everything else is the work. Steps with no timestamps contribute to
 * NEITHER total rather than being counted as instantaneous — measured on this tenant, guardrail steps
 * routinely carry no times, and treating those as 0ms would quietly understate the work.
 *
 * Note the steps of a seeded run can overlap (several share one startedAt), so summing spans can exceed
 * the wall clock. Work is therefore capped at the wall time when both are known: a "working time" longer
 * than the run itself is obviously wrong to a reader and destroys trust in the rest of the screen.
 */
export function splitRunTime(
  steps: readonly TimedStep[] | undefined,
  startedAt?: string | null,
  finishedAt?: string | null,
): TimeSplit {
  const all = steps ?? [];
  let working = 0;
  let waiting = 0;
  let sawWorking = false;
  let sawWaiting = false;

  for (const s of all) {
    const ms = span(s);
    if (ms === null) continue;
    if (s.kind === 'human') {
      waiting += ms;
      sawWaiting = true;
    } else {
      working += ms;
      sawWorking = true;
    }
  }

  let wallMs: number | null = null;
  if (startedAt && finishedAt) {
    const a = Date.parse(startedAt);
    const b = Date.parse(finishedAt);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) wallMs = b - a;
  }

  const workingMs = sawWorking ? (wallMs !== null ? Math.min(working, wallMs) : working) : null;
  // A run with no human step genuinely waited zero — that is a measurement, not an absence.
  const hasHumanStep = all.some((s) => s.kind === 'human');
  const waitingMs = sawWaiting ? waiting : hasHumanStep ? null : 0;

  return { workingMs, waitingMs, wallMs };
}

/** Median of the finite values, or null when there are none. */
function median(values: readonly number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

export interface TypicalTime {
  /** The sentence for the tile — never a bare dash. */
  value: string;
  /** The explanation underneath. */
  detail: string;
}

/**
 * Duration in words.
 *
 * This module first shipped its OWN wording ("2 min") while app-dashboard already had one
 * ("2 minutes") — two vocabularies for the same quantity, which a test caught immediately. The
 * formatter lives here now and app-dashboard re-exports it, so there is one wording and no import
 * cycle (app-dashboard depends on this module, not the other way round).
 */
export function describeDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return 'under a second';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Alias kept for readers of this module; same one wording. */
export const describeMs = describeDurationMs;

/**
 * The "Usually takes" tile, split.
 *
 * The point of this number is to answer "is this saving us time?". A single blended figure cannot: it is
 * dominated by however long a person took to get round to it, which is not what the automation did.
 */
export function typicalTime(splits: readonly TimeSplit[]): TypicalTime {
  const work = median(splits.map((s) => s.workingMs).filter((v): v is number => v !== null));
  const wait = median(splits.map((s) => s.waitingMs).filter((v): v is number => v !== null));
  const wall = median(splits.map((s) => s.wallMs).filter((v): v is number => v !== null));

  if (work === null) {
    // NO STEP TIMINGS. Fall back to the wall clock and SAY it is the whole elapsed time — an early
    // version of this returned "under a second" here, because a run with no human step reports zero
    // waiting and that zero became the answer. A caught-in-test reminder that an absent measurement
    // must never be rendered as a small one.
    if (wall === null) {
      return {
        value: 'Not measured',
        detail: 'No finished case has recorded timings yet, so we will not guess at a duration.',
      };
    }
    return {
      value: describeMs(wall),
      detail:
        'Start to finish, including any time spent waiting for a person — this app does not record per-step timings, so the two cannot be told apart.',
    };
  }
  if (wait === null || wait === 0) {
    return {
      value: describeMs(work),
      detail: 'Time the system spent working. No case waited on a person.',
    };
  }
  return {
    value: `${describeMs(work)} of work`,
    detail: `Plus ${describeMs(wait)} typically waiting for a person to get to it — that wait is the part worth shortening, and it is not the system being slow.`,
  };
}
