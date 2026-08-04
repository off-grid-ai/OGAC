// ─── What the app's front door leads with ────────────────────────────────────────────────────────────
//
// An app is not always a decision queue. The second shape — the founder's words — is "a job people come
// and run to get results", scheduled or on demand, where no case ever waits for a person.
//
// `appShape` already told us which is which and `buildAppWorkQueue` already wrote a shape-aware headline.
// The SCREEN ignored both. Measured live on the one job-shaped app in the demo tenants (Renewal &
// Persistency Nudge — scheduled, three steps, zero human steps):
//
//   · it led with "Waiting for you — Nothing is waiting on a decision right now", a section that can
//     never hold anything, because nothing in this app can wait for a decision;
//   · two of its five numbers ("Waiting on a person" 0, "Needed a person" 0%) are structurally zero for
//     this shape forever, so the reader has to work out which numbers mean something;
//   · the headline said "Run it again any time" and there was no way to run it on that screen;
//   · what it actually PRODUCED — the whole reason a job exists — appeared nowhere.
//
// This module is the pure half of fixing that: which numbers carry information for a shape, and what the
// last result was. Zero IO.

import type { AppShape } from './app-work-queue';

/** A number shown on the front door. Matches the dashboard's metric shape. */
export interface FrontDoorStat {
  label: string;
  value: string;
  tone?: string;
  detail?: string;
}

/**
 * Labels that only mean something when a person can be in the loop.
 *
 * Named rather than positional: the dashboard is free to reorder its metrics, and a rule that dropped
 * "the second and fifth" would silently start hiding the wrong ones.
 */
const PERSON_ONLY_STATS = new Set(['Waiting on a person', 'Needed a person']);

/**
 * Keep only the numbers that can ever be non-trivial for this shape.
 *
 * A permanently-zero number is not neutral: it competes for attention with the numbers that matter and
 * teaches the reader that this screen's figures are noise. For a queue every stat is kept — a zero there
 * is real news ("nothing is waiting today").
 */
export function statsForShape(
  shape: AppShape,
  stats: readonly FrontDoorStat[],
): FrontDoorStat[] {
  if (shape === 'queue') return [...stats];
  return stats.filter((s) => !PERSON_ONLY_STATS.has(s.label));
}

/** Whether to render the "waiting for a person" queue section at all. */
export function showsWaitingQueue(shape: AppShape, waitingCount: number): boolean {
  // A queue app with an empty queue still shows the section — "nothing is waiting" is the answer to the
  // question that screen exists to answer. A job app has no such question.
  return shape === 'queue' || waitingCount > 0;
}

export interface LatestResultInput {
  /** ISO. */
  startedAt: string;
  status: string;
  /** The run's own words for what it produced, already extracted by the caller. */
  outcome?: string | null;
  id: string;
}

export interface LatestResult {
  runId: string;
  /** ISO of the run that produced it. */
  when: string;
  /** What it produced, or null when the run recorded nothing readable. */
  outcome: string | null;
  /** Plain sentence for the case where there is no result to show — never a blank panel. */
  absence: string | null;
}

/**
 * The most recent result this job produced.
 *
 * Deliberately the newest FINISHED run, not the newest run: a job that is mid-run has not produced
 * anything yet, and showing the in-flight record as "the latest result" would present a partial read as
 * an answer.
 *
 * Returns an `absence` sentence rather than null when there is nothing to show, because the panel has to
 * say WHY it is empty — a never-run job and a job whose last run failed are different situations and a
 * blank panel conflates them.
 */
export function latestResult(runs: readonly LatestResultInput[]): LatestResult | null {
  const parsed = runs.filter((r) => Number.isFinite(Date.parse(r.startedAt)));
  if (parsed.length === 0) return null;

  const finished = parsed
    .filter((r) => r.status === 'done')
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

  if (finished.length === 0) {
    const failed = parsed.filter((r) => r.status === 'error').length;
    const newest = [...parsed].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
    return {
      runId: newest.id,
      when: newest.startedAt,
      outcome: null,
      absence:
        failed > 0
          ? 'The last run did not get to a result. Open it to see which step stopped.'
          : 'This is still running — a result will appear here when it finishes.',
    };
  }

  const newest = finished[0];
  const text = newest.outcome?.trim() ? newest.outcome.trim() : null;
  return {
    runId: newest.id,
    when: newest.startedAt,
    outcome: text,
    absence: text
      ? null
      : 'This run finished but recorded no readable result. Open it to see what each step did.',
  };
}
