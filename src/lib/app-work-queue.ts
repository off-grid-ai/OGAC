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

import { toCaseCandidate } from '@/lib/app-case-candidates';
import { caseRecordFrom } from '@/lib/connector-filter';

/** A run reduced to what the work screen needs. The caller maps its store rows onto this. */
export interface WorkRun {
  id: string;
  /** queued | running | awaiting_human | done | error | cancelled */
  status: string;
  /** ISO timestamp the run started. */
  startedAt: string;
  /** What the run is about, in the author's words. Blank is tolerated. */
  subject?: string | null;
  /** True when a person DECLINED it — a decision, not a breakdown. See isDeclinedByPerson. */
  declined?: boolean;
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
  /** Which shape of app this is — the caller lays the screen out accordingly. */
  shape: AppShape;
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
function headlineFor(waiting: number, recent: number, shape: AppShape): string {
  if (waiting === 1) return '1 case is waiting for a person to decide.';
  if (waiting > 1) return `${waiting} cases are waiting for a person to decide.`;

  // A JOB never waits on anybody, so "nothing is waiting" would answer a question nobody asked. What
  // matters is whether it has produced results and that you can run it now.
  if (shape === 'job') {
    if (recent === 0) return 'This has not been run yet.';
    return recent === 1 ? 'Run once so far. Run it again any time.' : `Run ${recent} times so far. Run it again any time.`;
  }

  if (recent > 0) {
    return recent === 1
      ? 'Nothing is waiting. 1 case has been handled.'
      : `Nothing is waiting. ${recent} cases have been handled.`;
  }
  return 'No cases yet.';
}

/**
 * What KIND of app this is. An app is not always a decision queue: a second, equally valid shape is a job
 * people come and run to get results (docs/APP_AS_PRODUCT.md §3b). Telling a job-shaped app's user that
 * "0 cases are waiting for a person to decide" is as wrong as opening a decision queue on a step editor.
 */
export type AppShape = 'queue' | 'job';

/** A job has no step that pauses for a person; a queue does. Derived, never configured. */
export function appShape(pausesForHuman: boolean): AppShape {
  return pausesForHuman ? 'queue' : 'job';
}

export interface AppWorkQueueInput {
  runs: readonly WorkRun[];
  trigger: ArrivalTrigger;
  /** Whether any step of this app pauses for a human decision. */
  pausesForHuman?: boolean;
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

  const shape = appShape(input.pausesForHuman === true);

  return {
    shape,
    waiting,
    recent,
    headline: headlineFor(waiting.length, finished.length, shape),
    howWorkArrives: arrivalSentence(input.trigger),
    // In-flight runs (queued/running) count as activity: the app is working, so this is not a
    // first-run empty state even though nothing is waiting or finished yet.
    isEmpty: runs.length === 0,
  };
}

/**
 * A run's status as a non-technical label.
 *
 * `declined` is separated from `error` deliberately: a person rejecting a case halts the run through the
 * same mechanism as a failure, and calling that "Could not finish" told the reader the app had broken when
 * in fact it had done its job.
 */
export function statusLabel(status: string, opts: { declined?: boolean } = {}): string {
  if (opts.declined) return 'Declined by a person';
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

/**
 * Group a whole number with thousands separators, WITHOUT toLocaleString.
 *
 * "Amount: 361030" reads as an unfinished field; "Amount: 361,030" reads as money. toLocaleString is
 * avoided deliberately — it formats in the server's locale during SSR and the browser's on hydration,
 * which is exactly the mismatch that broke this page's first deploy. No currency symbol is added: this
 * module is generic and cannot know the tenant's currency, and guessing one would be a lie on the
 * screen.
 */
function groupDigits(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const negative = value < 0;
  const [whole, fraction] = Math.abs(value).toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Whether a field's NAME means a quantity, so its digits should be grouped.
 *
 * Grouping every long number was wrong: `policy_number: 88123` became "88,123", turning an identifier
 * into what looks like money. An account number, PAN, reference or policy number must survive
 * verbatim — a reader who copies a mangled identifier off this screen has been actively misled.
 */
const QUANTITY_KEY = /(amount|value|total|price|cost|salary|balance|sum|limit|premium|payout|claim_?amt)/i;
const IDENTIFIER_KEY = /(number|no|id|ref|code|pan|account|acct|policy|ifsc|phone|mobile|pin|otp)$/i;

function isQuantityKey(key: string): boolean {
  if (IDENTIFIER_KEY.test(key)) return false;
  return QUANTITY_KEY.test(key);
}

function scalarText(value: unknown, key = ''): string | null {
  const quantity = isQuantityKey(key);
  if (typeof value === 'string') {
    const t = value.trim().replace(/\s+/g, ' ');
    if (t.length === 0) return null;
    // A numeric STRING is still a number to the reader — but only group it if the field is a quantity.
    if (quantity && /^-?\d{4,}(\.\d+)?$/.test(t)) return groupDigits(Number(t));
    return t.slice(0, MAX_SUBJECT);
  }
  if (typeof value === 'number') return quantity ? groupDigits(value) : String(value);
  if (typeof value === 'boolean') return String(value);
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
  // Unwrap the trigger envelope with the SAME rule the data steps use to find the case, rather than a
  // second copy of that knowledge here. When the picked record moved into `case`, this function stopped
  // finding anything and every new row in the queue read "Case 9ba6a4" — the queue lost its case names
  // while the runs themselves were working perfectly.
  const envelope = input as Record<string, unknown>;
  const record = caseRecordFrom(envelope);

  for (const key of SUBJECT_KEYS) {
    const direct = scalarText(record[key], key);
    if (direct) return direct;
  }

  // Describing a data record so a person recognises it is exactly what the case PICKER does, and it does it
  // well ("Meera Malhotra · submitted · 41,346.44"). Reusing that rule keeps the queue row and the row the
  // person clicked to create it worded the same way, instead of two descriptions of one record drifting apart.
  const described = toCaseCandidate(record, 0);
  // Its label falls back to "Record 1" when nothing is recognisable; that is not a subject.
  if (!/^Record \d+$/.test(described.label)) {
    return [described.label, described.detail].filter(Boolean).join(' · ').slice(0, MAX_SUBJECT);
  }

  // No named subject: describe the case by its first couple of fields, labelled readably.
  const parts: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const text = scalarText(value, key);
    if (!text) continue;
    const label = key.replace(/[_-]+/g, ' ').trim();
    parts.push(`${label.charAt(0).toUpperCase()}${label.slice(1)}: ${text}`);
    if (parts.length === 2) break;
  }
  if (parts.length > 0) return parts.join(' · ').slice(0, MAX_SUBJECT);
  // Last resort: the readable line the person saw when they submitted it, wherever it sits in the envelope.
  return envelopeText(envelope) ?? null;
}

/** The primary text a trigger carried, searched one level into the envelope. Never invents a subject. */
function envelopeText(envelope: Record<string, unknown>, depth = 0): string | null {
  if (depth > 3) return null;
  for (const key of ['input', 'text', 'message', 'subject', 'body']) {
    const value = envelope[key];
    const text = scalarText(value, key);
    if (text) return text;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = envelopeText(value as Record<string, unknown>, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * What a row is labelled when the run's input cannot be summarised.
 *
 * Every such row previously read the identical word "Case", so a queue of them was indistinguishable —
 * you could not tell two rows apart, or refer to one in a conversation. Appending a short reference
 * from the run id fixes both without inventing content that is not there.
 */
export function caseLabel(subject: string | null | undefined, runId: string): string {
  const trimmed = subject?.trim();
  if (trimmed) return trimmed;
  const ref = runId.replace(/^[a-z]+_/i, '').slice(0, 6);
  return ref ? `Case ${ref}` : 'Case';
}

// ─── caseTrail — what actually happened to a case, in the person's language ───────────────────────────
//
// The governed run was invisible: a finished case showed a status and a time, and nothing about the machinery
// that produced it. That is the thing which distinguishes this from a spreadsheet, and it left no trace for
// the person relying on the decision.
//
// This describes ONLY what the run's own steps record. The demo runs carry no provenance signature and no
// guardrail steps, so nothing here claims a signature or a guardrail verdict — asserting governance that did
// not happen would be far worse than showing none. When those steps DO run, they appear, because the summary
// is derived from the steps rather than written by hand.

export interface TrailStep {
  kind?: string;
  status?: string;
}

/**
 * A one-line account of a case: "Read 2 sources · AI assessed it · a person approved · report produced".
 *
 * Returns null when the run records no completed steps — an empty trail is better than a fabricated one.
 */
export function caseTrail(
  steps: readonly TrailStep[] | undefined,
  opts: { signed?: boolean } = {},
): string | null {
  const done = (steps ?? []).filter((s) => s.status === 'done');
  if (done.length === 0) return null;

  const count = (kind: string) => done.filter((s) => s.kind === kind).length;
  const reads = count('connector-query');
  const agents = count('agent');
  const humans = count('human');
  const guardrails = count('guardrail');
  const outputs = count('output');
  const actions = count('action');

  const parts: string[] = [];
  if (reads > 0) parts.push(reads === 1 ? 'read 1 source' : `read ${reads} sources`);
  if (guardrails > 0) parts.push(guardrails === 1 ? 'passed a safety check' : `passed ${guardrails} safety checks`);
  if (agents > 0) parts.push('AI assessed it');
  if (humans > 0) parts.push('a person decided');
  if (actions > 0) parts.push(actions === 1 ? 'took 1 action' : `took ${actions} actions`);
  if (outputs > 0) parts.push('produced a result');
  // Provenance last: it is the seal over everything above it, not another step in the sequence.
  if (opts.signed) parts.push('signed and tamper-evident');

  return parts.length > 0 ? parts.join(' · ') : null;
}
