// ─── The app's DASHBOARD — PURE (docs/APP_AS_PRODUCT.md, founder's list) ────────────────────────────
//
// "it should have the ability to have a dashboard". This was the only item on that list with no component
// behind it at all.
//
// Written for the department, not the platform team. A grievance officer or an accounts clerk wants to
// know: how much did we get through, what is stuck, how long does it take, and how often does a person
// have to step in. They do not want tokens, latency percentiles, or model names — those belong to the
// operator surfaces, and naming them here would be the same mistake as the technical vocabulary the work
// screen already strips out.
//
// Zero-IO so every counting and wording rule is unit-testable. The caller supplies the runs.

import { splitRunTime, typicalTime, type TimedStep } from '@/lib/run-time-split';

export interface DashboardRun {
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  /** True when this run paused for a person at any point. */
  neededPerson?: boolean;
  /** True when a person DECLINED it. Counted as handled, not as a failure. */
  declined?: boolean;
  /**
   * The run's steps, with their own timings — so working time can be told apart from the time the case
   * sat in someone's queue. Without this the tile blended the two and averaged 17 hours.
   */
  steps?: readonly TimedStep[];
}

export interface DashboardMetric {
  label: string;
  /** Already formatted for display — the rule owns the wording, not the component. */
  value: string;
  /** One line of plain-language meaning. Never a definition of a metric. */
  detail: string;
  /** `attention` when this number is the one to act on. */
  tone: 'neutral' | 'attention';
}

export interface AppDashboard {
  metrics: DashboardMetric[];
  /** One sentence summarising the period, or the honest empty case. */
  headline: string;
  /** True when there is nothing to report yet. */
  isEmpty: boolean;
}

const DONE = 'done';
const FAILED = new Set(['error', 'cancelled']);
const WAITING = 'awaiting_human';

/** Whole days between two instants, used to describe the window. */
const DAY_MS = 86_400_000;

/** Median, not mean: one pathological run should not distort "how long this usually takes". */
function medianMs(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/** A duration a person reads without converting anything. */
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

/** A whole percentage, or null when there is nothing to divide by. */
function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export interface AppDashboardInput {
  runs: readonly DashboardRun[];
  /** Now, in epoch ms — passed in so the rule stays pure and testable. */
  nowMs: number;
  /** Trailing window in days. */
  windowDays?: number;
}

/**
 * Build the dashboard.
 *
 * Every number is stated for the window, and the window is named in the headline — a bare "42" invites
 * the reader to assume it is all-time. Percentages are omitted rather than shown as 0% when there is
 * nothing to divide by, because "0% needed a person" reads as a finding when it is actually no data.
 */
export function buildAppDashboard(input: AppDashboardInput): AppDashboard {
  const windowDays = input.windowDays ?? 30;
  const since = input.nowMs - windowDays * DAY_MS;

  const inWindow = input.runs.filter((r) => {
    const t = Date.parse(r.startedAt);
    return Number.isFinite(t) && t >= since;
  });

  // A case a person declined is HANDLED: someone looked at it and decided. Counting it as a failure both
  // overstated the failure rate and understated the work the app actually got done.
  const completed = inWindow.filter((r) => r.status === DONE || r.declined === true);
  const failed = inWindow.filter((r) => FAILED.has(r.status) && r.declined !== true);
  // Waiting is NOT windowed. A case pending a decision is pending regardless of when it arrived, and an
  // OLD one is more urgent, not less. Windowing it produced a visible contradiction: the queue said "2
  // cases are waiting" while this metric said 1, because one had been waiting longer than the window.
  const waiting = input.runs.filter((r) => r.status === WAITING);
  const neededPerson = inWindow.filter((r) => r.neededPerson === true);

  const typical = typicalTime(
    completed.map((r) => splitRunTime(r.steps, r.startedAt, r.finishedAt ?? null)),
  );

  const durations = completed
    .map((r) => {
      const start = Date.parse(r.startedAt);
      const end = r.finishedAt ? Date.parse(r.finishedAt) : NaN;
      return Number.isFinite(start) && Number.isFinite(end) ? end - start : NaN;
    })
    .filter((ms): ms is number => Number.isFinite(ms) && ms >= 0);

  const personShare = percent(neededPerson.length, inWindow.length);

  const metrics: DashboardMetric[] = [
    {
      label: 'Handled',
      value: String(completed.length),
      detail: 'Cases the app finished on its own or after approval.',
      tone: 'neutral',
    },
    {
      label: 'Waiting on a person',
      value: String(waiting.length),
      detail:
        waiting.length > 0
          ? 'Paused until someone decides — however long ago they arrived.'
          : 'Nothing is currently paused for a decision.',
      tone: waiting.length > 0 ? 'attention' : 'neutral',
    },
    {
      label: 'Could not finish',
      value: String(failed.length),
      detail:
        failed.length > 0
          ? 'Worth a look — these stopped before producing a result.'
          : 'Every case reached a result.',
      tone: failed.length > 0 ? 'attention' : 'neutral',
    },
    {
      // WORK AND WAITING, SEPARATED. A single blended figure is dominated by however long a person took
      // to get round to the case, so it answered "is this saving us time?" with 17 hours and read as a
      // dash whenever timings were missing. Both halves are stated, and the wait is named as the part
      // worth shortening rather than looking like the system being slow.
      label: 'Usually takes',
      value: typical.value,
      detail: typical.detail,
      tone: 'neutral',
    },
    {
      label: 'Needed a person',
      value: personShare === null ? '—' : `${personShare}%`,
      detail:
        personShare === null
          ? 'No cases yet in this period.'
          : 'How often a case had to pause for someone to decide.',
      tone: 'neutral',
    },
  ];

  const headline = (() => {
    if (inWindow.length === 0) return `No cases in the last ${windowDays} days.`;
    const parts = [`${inWindow.length} case${inWindow.length === 1 ? '' : 's'} in the last ${windowDays} days`];
    if (waiting.length > 0) parts.push(`${waiting.length} waiting on a person`);
    if (failed.length > 0) parts.push(`${failed.length} could not finish`);
    return `${parts.join(' · ')}.`;
  })();

  return { metrics, headline, isEmpty: inWindow.length === 0 };
}
