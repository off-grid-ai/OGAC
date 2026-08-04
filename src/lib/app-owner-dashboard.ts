// ─── The app owner's dashboard ───────────────────────────────────────────────────────────────────────
//
// "A dashboard" is on the founder's list of what every app has, and there was no generic one.
// `CockpitDashboard` looks like it but is the bespoke RM cross-sell cockpit — assets under management, a
// lead→won funnel, product mix — for an app that no longer exists. Nothing answered the question an
// ordinary app owner actually has: **is this thing working, and where is it going wrong?**
//
// Everything here is derived from the app's own runs. Nothing is invented: there is no per-run cost on
// app_runs, so there is no cost panel — a fabricated ₹0.00 reads as "this is free", which is the defect
// `money.ts` was written to stop.
//
// Pure. Zero IO.

export interface OwnerRun {
  /** ISO. */
  startedAt: string;
  /** ISO, or null while unfinished. */
  finishedAt?: string | null;
  status: string;
  /** Already decided by the caller with isDeclinedByPerson — a rejection is not a breakdown. */
  declined?: boolean;
  /** Minutes the app was working, and minutes it sat waiting on a person. */
  workingMs?: number | null;
  waitingMs?: number | null;
}

// ─── Volume: is this being used, and is that changing? ───────────────────────────────────────────────

export interface DayCount {
  /** YYYY-MM-DD, UTC. */
  day: string;
  count: number;
}

/**
 * Cases per day over the last `days`, oldest first, with **no gaps**.
 *
 * Missing days are emitted as zero rather than skipped. A chart that only plots the days something
 * happened silently closes the gaps up and makes an app that ran twice in a month look continuous.
 */
export function volumeByDay(runs: readonly OwnerRun[], now: Date, days = 30): DayCount[] {
  const counts = new Map<string, number>();
  for (const r of runs) {
    const t = Date.parse(r.startedAt);
    if (!Number.isFinite(t)) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const out: DayCount[] = [];
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * 86_400_000;
  for (let i = 0; i < days; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day, count: counts.get(day) ?? 0 });
  }
  return out;
}

/**
 * Whether use is rising or falling — the second half of the window against the first.
 *
 * Returns null when there is too little to compare. A trend claimed off two cases is noise presented as
 * a finding, and an owner who acts on it has been misled by us rather than by the data.
 */
export function volumeTrend(
  series: readonly DayCount[],
): { direction: 'up' | 'down' | 'flat'; sentence: string } | null {
  const total = series.reduce((n, d) => n + d.count, 0);
  if (series.length < 4 || total < 6) return null;
  const mid = Math.floor(series.length / 2);
  const earlier = series.slice(0, mid).reduce((n, d) => n + d.count, 0);
  const later = series.slice(mid).reduce((n, d) => n + d.count, 0);
  if (earlier === 0 && later === 0) return null;
  const delta = later - earlier;
  // Under a fifth either way is not a change worth reporting.
  if (Math.abs(delta) * 5 < Math.max(earlier, later)) {
    return { direction: 'flat', sentence: 'Use is steady across this period.' };
  }
  return delta > 0
    ? { direction: 'up', sentence: `Busier lately — ${later} cases recently against ${earlier} before that.` }
    : { direction: 'down', sentence: `Quieter lately — ${later} cases recently against ${earlier} before that.` };
}

// ─── What it decided ─────────────────────────────────────────────────────────────────────────────────

export interface OutcomeMix {
  completed: number;
  declined: number;
  failed: number;
  waiting: number;
  inFlight: number;
  total: number;
  /** One sentence for the panel. Never a bare set of numbers. */
  sentence: string;
}

/**
 * The mix of what happened to this app's cases.
 *
 * `declined` is kept apart from `failed` — a person rejecting a case is the app doing its job, and
 * counting it as a breakdown overstated failures badly enough that one app read 7 failures instead of 1.
 */
export function outcomeMix(runs: readonly OwnerRun[]): OutcomeMix {
  let completed = 0;
  let declined = 0;
  let failed = 0;
  let waiting = 0;
  let inFlight = 0;
  for (const r of runs) {
    if (r.declined) declined++;
    else if (r.status === 'done') completed++;
    else if (r.status === 'error') failed++;
    else if (r.status === 'awaiting_human') waiting++;
    else inFlight++;
  }
  const total = runs.length;
  const decided = completed + declined;
  // "so far" is load-bearing. The volume band above this counts a 30-DAY WINDOW and this counts every
  // run ever, so the same screen showed "17 cases in the last 30 days" beside "10 of 18 cases" — two
  // denominators, unlabelled, one screen. A reader cannot tell which number is the real one.
  const sentence =
    total === 0
      ? 'No cases yet, so there is nothing to summarise.'
      : failed > 0
        ? `Of all ${total} cases so far, ${decided} reached a decision. ${failed} could not finish — those are the ones worth a look.`
        : `Of all ${total} cases so far, every one that finished reached a decision. Nothing broke.`;
  return { completed, declined, failed, waiting, inFlight, total, sentence };
}

// ─── Where the time goes ─────────────────────────────────────────────────────────────────────────────

export interface TimeUse {
  /** Total ms the app itself was working. */
  workingMs: number;
  /** Total ms cases sat waiting for a person. */
  waitingMs: number;
  /** 0..100, share of the total that was waiting. Null when nothing was measured. */
  waitingShare: number | null;
  /** What to do about it, or a statement that there is nothing to do. */
  sentence: string;
}

/**
 * Work time against waiting time across every measured run.
 *
 * These are reported separately on purpose. A single blended "average time" is dominated by however long
 * a person took to get round to the case, so it answered "is this saving us time?" with a number that was
 * really about staffing — and named the system as the slow part when it was not.
 */
export function timeUse(runs: readonly OwnerRun[]): TimeUse {
  let workingMs = 0;
  let waitingMs = 0;
  let measured = 0;
  for (const r of runs) {
    const w = r.workingMs ?? 0;
    const q = r.waitingMs ?? 0;
    if (w > 0 || q > 0) measured++;
    workingMs += w;
    waitingMs += q;
  }
  const total = workingMs + waitingMs;
  if (measured === 0 || total === 0) {
    return {
      workingMs,
      waitingMs,
      waitingShare: null,
      sentence: 'No step timings have been recorded yet, so time cannot be broken down.',
    };
  }
  const share = Math.round((waitingMs / total) * 100);
  return {
    workingMs,
    waitingMs,
    waitingShare: share,
    sentence:
      share >= 60
        ? `${share}% of the time is cases waiting for a person, not the app working. Shortening that queue is the fastest win available.`
        : share <= 10
          ? 'Almost all the elapsed time is the app working — people are not the bottleneck here.'
          : `${share}% of the time is spent waiting for a person.`,
  };
}
