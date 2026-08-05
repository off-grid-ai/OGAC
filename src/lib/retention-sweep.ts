// ─── Retention that actually happens, and leaves evidence ──────────────────────────────────────────
//
// Retention settings existed and were EVALUATED — for display. A page could say an asset was "due",
// and nothing ever acted on it. No sweep had ever run, and there was no record of one, so "prove you
// delete data when you said you would" had no answer.
//
// This is the pure half: which record classes the console can honestly act on, what a sweep would
// touch, and how to describe the outcome. Zero IO.

/**
 * The record classes the CONSOLE owns and can therefore actually enforce retention on.
 *
 * Warehouse assets are deliberately absent. The console cannot delete from the warehouse or the lake
 * — that is the data engine's plane — and a sweep that claimed to would be the same lie as an erasure
 * that reports rows it never deleted. Those are reported as deferred, by name.
 */
export const RETAINABLE_CLASSES = [
  {
    id: 'app_runs',
    label: 'App run records',
    detail: 'The full decision trail of every app run, including the data each step read.',
  },
  {
    id: 'agent_runs',
    label: 'Agent run records',
    detail: 'Agent execution history and the prompts and answers within it.',
  },
  {
    id: 'knowledge_chunks',
    label: 'Indexed document text',
    detail: 'The searchable text extracted from uploaded documents.',
  },
  {
    // Added when apps gained the ability to WRITE to the object store. Until then the note on this
    // surface said lake purging "stays with the data engine and is reported as deferred" — honest at
    // the time, a hole afterwards: a governed run could accumulate files that no policy bounded, and
    // "we do not keep this longer than N days" stopped being true for the newest thing we produce.
    //
    // Enforced by the BUCKET's own schedule rather than a delete loop here: the store already expires
    // objects, and a second clock in the console would only hold the promise while our process runs.
    id: 'lake_objects',
    label: 'Files saved to the object store',
    detail: 'Files that workflows write to the private object store, such as generated assessments and exports.',
  },
] as const;

export type RetainableClass = (typeof RETAINABLE_CLASSES)[number]['id'];

export function classLabel(id: string): string {
  return RETAINABLE_CLASSES.find((c) => c.id === id)?.label ?? id;
}

export function isRetainableClass(id: string): id is RetainableClass {
  return RETAINABLE_CLASSES.some((c) => c.id === id);
}

/** What to do when the clock runs out. */
export const RETENTION_ACTIONS = ['delete', 'redact'] as const;
export type SweepAction = (typeof RETENTION_ACTIONS)[number];

export interface RetentionRule {
  recordClass: RetainableClass;
  /** Days to keep. 0 means keep indefinitely — an explicit choice, not an absence. */
  retainDays: number;
  action: SweepAction;
  /** A legal hold suspends the sweep for this class, and the evidence must say so. */
  legalHold?: boolean;
}

export interface SweepTarget {
  recordClass: RetainableClass;
  action: SweepAction;
  /** Everything created strictly before this instant is out of retention. */
  cutoff: Date;
  /**
   * The window itself, carried alongside the cutoff. A database sweep needs the instant; a store that
   * expires objects on its own schedule needs the NUMBER OF DAYS, because that is what its rule says.
   * Deriving days back out of a cutoff would drift by a day depending on when the sweep ran.
   */
  retainDays: number;
}

export interface SweepPlan {
  targets: SweepTarget[];
  /** Classes deliberately not acted on, each with the reason — never silently skipped. */
  skipped: { recordClass: string; reason: string }[];
}

/**
 * Turn the rules into what a sweep would actually do. The skip reasons matter as much as the targets:
 * a class held indefinitely and a class under legal hold are both "nothing happened", and an evidence
 * record that cannot tell them apart is not evidence.
 */
export function planSweep(rules: readonly RetentionRule[], now: Date): SweepPlan {
  const targets: SweepTarget[] = [];
  const skipped: { recordClass: string; reason: string }[] = [];
  for (const r of rules) {
    if (r.legalHold) {
      skipped.push({
        recordClass: r.recordClass,
        reason: 'Under legal hold — retention is suspended until the hold is lifted',
      });
      continue;
    }
    if (!Number.isFinite(r.retainDays) || r.retainDays <= 0) {
      skipped.push({
        recordClass: r.recordClass,
        reason: 'Kept indefinitely — no retention limit is set for this record class',
      });
      continue;
    }
    targets.push({
      recordClass: r.recordClass,
      action: r.action,
      cutoff: new Date(now.getTime() - r.retainDays * 86_400_000),
      retainDays: r.retainDays,
    });
  }
  // Any class with no rule at all is a gap, and must read as one rather than as compliance.
  for (const c of RETAINABLE_CLASSES) {
    if (!rules.some((r) => r.recordClass === c.id)) {
      skipped.push({
        recordClass: c.id,
        reason: 'No retention rule has been set — these records are kept forever by default',
      });
    }
  }
  return { targets, skipped };
}

export interface SweepOutcome {
  recordClass: string;
  action: string;
  affected: number;
  /** Re-counted AFTER the work: rows still older than the cutoff. Non-zero means it did not finish. */
  remaining: number;
  /**
   * Optional per-destination narrative. A row count answers "how much"; for a class enforced somewhere
   * else — an object store expiring files on its own schedule — the auditor also needs WHERE and on
   * whose authority, and a bare number cannot carry that.
   */
  detail?: string;
  error?: string;
}

/** One line an auditor reads off the evidence record. */
export function summariseSweep(outcomes: readonly SweepOutcome[]): string {
  if (!outcomes.length) return 'Nothing was out of retention';
  const total = outcomes.reduce((n, o) => n + o.affected, 0);
  const failed = outcomes.filter((o) => o.error || o.remaining > 0);
  const head = `${total.toLocaleString()} record${total === 1 ? '' : 's'} past their retention limit ${
    outcomes.every((o) => o.action === 'redact') ? 'redacted' : 'removed'
  }`;
  return failed.length
    ? `${head} — but ${failed.length} record class${failed.length === 1 ? '' : 'es'} did not finish`
    : head;
}

/** The sweep is only proven when every target completed and nothing older than its cutoff is left. */
export function sweepComplete(outcomes: readonly SweepOutcome[]): boolean {
  return outcomes.every((o) => !o.error && o.remaining === 0);
}
