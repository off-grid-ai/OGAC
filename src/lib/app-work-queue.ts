// ─── The app's WORK view — PURE rules (APP_AS_PRODUCT item 3) ───────────────────────────────────────
//
// An app automates a process the enterprise already runs, so work arrives on its own. The person who
// uses the app opens it to deal with what is waiting — not to inspect the app's own configuration.
// Landing on Build made every app read as an entry in an AI console instead of the department's tool
// for that process.
//
// This module decides what that landing screen SAYS. It is zero-IO so the plain-language rules are
// unit-testable, and it is deliberately written for a non-technical reader: a grievance officer or an
// accounts clerk, not an operator. No pipeline, guardrail, eval or provenance vocabulary appears in
// anything this module returns.
//
// Read-only matters here: the public demo grants view-only access, so this screen has to be
// understandable by READING it. Every string is therefore a statement of fact about the work, never an
// instruction that only a privileged user could carry out.

/** A run reduced to what the work screen needs. The caller maps its store rows onto this. */
export interface WorkRun {
  id: string;
  /** queued | running | awaiting_human | done | error | cancelled */
  status: string;
  /** ISO timestamp the run started. */
  startedAt: string;
  /** What the run is about, in the author's words. Blank is tolerated. */
  subject?: string | null;
}

/** How work reaches this app, expressed for someone who does not know what a webhook is. */
export type ArrivalTrigger =
  | 'on-demand'
  | 'webhook'
  | 'email'
  | 'whatsapp'
  | 'schedule'
  | (string & {});

export interface AppWorkQueue {
  /** Cases paused for a person to decide, newest first. */
  waiting: WorkRun[];
  /** Recently finished cases, newest first. */
  recent: WorkRun[];
  /** One sentence: what is on this person's plate. */
  headline: string;
  /** One sentence: how new cases reach this app. */
  howWorkArrives: string;
  /** True when there is genuinely nothing to show — the caller renders a first-run explanation. */
  isEmpty: boolean;
}

const AWAITING = 'awaiting_human';
const FINISHED = new Set(['done', 'error', 'cancelled']);

/** Newest first, tolerating unparseable timestamps rather than throwing on bad data. */
function byNewest(a: WorkRun, b: WorkRun): number {
  const ta = Date.parse(a.startedAt);
  const tb = Date.parse(b.startedAt);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return tb - ta;
}

/**
 * How new cases reach this app, in plain language.
 *
 * "A webhook starts a run" means nothing to an accounts clerk. What they need to know is whether work
 * turns up by itself or whether somebody has to start it — that changes how they use the app.
 */
export function arrivalSentence(trigger: ArrivalTrigger): string {
  switch (trigger) {
    case 'email':
      return 'New cases arrive by email, and are picked up automatically.';
    case 'whatsapp':
      return 'New cases arrive by WhatsApp, and are picked up automatically.';
    case 'webhook':
      return 'New cases arrive automatically from a connected system.';
    case 'schedule':
      return 'This runs on its own to a set schedule.';
    case 'on-demand':
      return 'Somebody starts each case here when it is needed.';
    default:
      // An unrecognised trigger must not claim work arrives automatically when we cannot confirm it.
      return 'Cases are started from this screen.';
  }
}

/** The headline: what is on this person's plate, stated as fact so a read-only viewer can follow it. */
function headlineFor(waiting: number, recent: number): string {
  if (waiting === 1) return '1 case is waiting for a person to decide.';
  if (waiting > 1) return `${waiting} cases are waiting for a person to decide.`;
  if (recent > 0) {
    return recent === 1
      ? 'Nothing is waiting. 1 case has been handled.'
      : `Nothing is waiting. ${recent} cases have been handled.`;
  }
  return 'No cases yet.';
}

export interface AppWorkQueueInput {
  runs: readonly WorkRun[];
  trigger: ArrivalTrigger;
  /** How many finished cases to show. */
  recentLimit?: number;
}

/**
 * Build the work screen's model.
 *
 * `waiting` is never truncated — a queue that silently hides cases would let one sit unattended
 * forever, which is the whole failure this screen exists to prevent. Only the finished list is capped.
 */
export function buildAppWorkQueue(input: AppWorkQueueInput): AppWorkQueue {
  const runs = [...input.runs];
  const waiting = runs.filter((r) => r.status === AWAITING).sort(byNewest);
  const finished = runs.filter((r) => FINISHED.has(r.status)).sort(byNewest);
  const recent = finished.slice(0, input.recentLimit ?? 8);

  return {
    waiting,
    recent,
    headline: headlineFor(waiting.length, finished.length),
    howWorkArrives: arrivalSentence(input.trigger),
    // In-flight runs (queued/running) count as activity: the app is working, so this is not a
    // first-run empty state even though nothing is waiting or finished yet.
    isEmpty: runs.length === 0,
  };
}

/** A run's status as a non-technical label. */
export function statusLabel(status: string): string {
  switch (status) {
    case AWAITING:
      return 'Waiting for you';
    case 'running':
      return 'Working on it';
    case 'queued':
      return 'Queued';
    case 'done':
      return 'Completed';
    case 'error':
      return 'Could not finish';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

// ─── runSubject — a readable line for a case, derived from the run's own input ────────────────────
//
// Every row on the work screen rendered the literal word "Case", because nothing was deriving a subject
// from the run. A queue of eight identical "Case · Completed" rows is unusable: you cannot tell which
// case is yours, which is urgent, or whether two rows are the same claim twice.
//
// The input jsonb IS the case, so the subject comes from it. Preference order is deliberate: an
// explicit human-authored field first, then the first short scalar values. We never invent a subject —
// an input we cannot summarise returns null and the caller shows its own fallback.

/** Field names an author is likely to have used for "what this case is about". */
const SUBJECT_KEYS = ['subject', 'title', 'summary', 'name', 'description', 'query', 'question'];

/** Values long enough to be a document body rather than a label are not subjects. */
const MAX_SUBJECT = 120;

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim().replace(/\s+/g, ' ');
    return t.length > 0 ? t.slice(0, MAX_SUBJECT) : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * A one-line subject for a case, or null when the input cannot honestly be summarised.
 *
 * Keys are humanised (claim_amount → "Claim amount") because a non-technical reader should never see a
 * database-shaped identifier in the thing they are reading.
 */
export function runSubject(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;

  for (const key of SUBJECT_KEYS) {
    const direct = scalarText(record[key]);
    if (direct) return direct;
  }

  // No named subject: describe the case by its first couple of fields, labelled readably.
  const parts: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const text = scalarText(value);
    if (!text) continue;
    const label = key.replace(/[_-]+/g, ' ').trim();
    parts.push(`${label.charAt(0).toUpperCase()}${label.slice(1)}: ${text}`);
    if (parts.length === 2) break;
  }
  return parts.length > 0 ? parts.join(' · ').slice(0, MAX_SUBJECT) : null;
}
