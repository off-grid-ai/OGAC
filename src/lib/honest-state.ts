// ─── The SEVEN states the product is allowed to be in — PURE ───────────────────────────────────────
//
// ROADMAP §11, verbatim: "The UI must distinguish: Production-ready · Experimental · Degraded · Not
// configured · Failed open · Failed closed · Awaiting approval. The product must never imply that a
// control is active when it is not."
//
// Every one of those was handled somewhere, and nowhere the same way: a data-quality 400 read as
// "unreachable" until it was fixed by hand; a failed read used to render as "no rows"; an unscoped read
// said nothing. Each was repaired individually, which IS the gap — seven ad-hoc vocabularies is not a
// vocabulary. This module is the single one: the names, the sentences, the tone, and the rule for
// picking a state from what a probe actually returned.
//
// Two distinctions this exists to protect, because they are the ones that get blurred:
//   • FAILED OPEN vs FAILED CLOSED — both are "it broke", and they are opposite facts. Failed open
//     means the work continued unchecked; failed closed means it was stopped. A buyer must never have
//     to guess which one a red badge means.
//   • NOT CONFIGURED vs DEGRADED — "we never set this up" is not "this is struggling". Reporting the
//     first as the second invents an outage; reporting the second as the first hides one.

export type HonestState =
  | 'ready'
  | 'experimental'
  | 'degraded'
  | 'not-configured'
  | 'failed-open'
  | 'failed-closed'
  | 'awaiting-approval';

export type StateTone = 'good' | 'warn' | 'bad' | 'neutral' | 'info';

export interface StateDescriptor {
  state: HonestState;
  /** The badge word. Short, lower-case in the UI's own voice, never an engine's word. */
  label: string;
  tone: StateTone;
  /** One sentence a non-technical operator can act on. Shown as the tooltip / helper line. */
  meaning: string;
  /** True when work is still being done without the control in force — the case that must never be quiet. */
  unprotected: boolean;
}

const DESCRIPTORS: Record<HonestState, StateDescriptor> = {
  ready: {
    state: 'ready',
    label: 'Live',
    tone: 'good',
    meaning: 'Configured, reachable and enforcing. This is doing what the policy says it does.',
    unprotected: false,
  },
  experimental: {
    state: 'experimental',
    label: 'Experimental',
    tone: 'info',
    meaning:
      'Available for trials, not for anything that matters yet. Results may change without notice.',
    unprotected: false,
  },
  degraded: {
    state: 'degraded',
    label: 'Degraded',
    tone: 'warn',
    meaning:
      'Working, but not fully — some checks are being skipped or answers are slower and less complete than normal.',
    unprotected: false,
  },
  'not-configured': {
    state: 'not-configured',
    label: 'Not set up',
    tone: 'neutral',
    meaning:
      'Nothing is wrong — this has simply never been configured, so it is not doing anything yet.',
    unprotected: false,
  },
  'failed-open': {
    state: 'failed-open',
    label: 'Failed open',
    tone: 'bad',
    // The dangerous one. Say plainly that work continued WITHOUT the control.
    meaning:
      'This control could not run and work was allowed to continue without it. Anything processed since is unchecked.',
    unprotected: true,
  },
  'failed-closed': {
    state: 'failed-closed',
    label: 'Failed closed',
    tone: 'warn',
    meaning:
      'This control could not run, so work was stopped rather than allowed through unchecked. Nothing slipped past.',
    unprotected: false,
  },
  'awaiting-approval': {
    state: 'awaiting-approval',
    label: 'Awaiting approval',
    tone: 'info',
    meaning: 'Paused on purpose, waiting for a person to decide. Nothing proceeds until they do.',
    unprotected: false,
  },
};

export function describeState(state: HonestState): StateDescriptor {
  return DESCRIPTORS[state];
}

export function allStates(): StateDescriptor[] {
  return Object.values(DESCRIPTORS);
}

/** What a probe of a control can tell us. Every field optional — this reads what arrived, not what we hoped. */
export interface ProbeFacts {
  /** Has an operator set this up at all? */
  configured?: boolean;
  /** Did the check actually run to completion? */
  reachable?: boolean;
  /** When it could not run, did the system stop the work (closed) or let it through (open)? */
  failMode?: 'open' | 'closed';
  /** Ran, but with reduced coverage — some scanners suppressed, some metrics missing. */
  partial?: boolean;
  /** Flagged as experimental by its own metadata. */
  experimental?: boolean;
  /** Paused for a human decision. */
  awaitingApproval?: boolean;
}

/**
 * THE rule for turning a probe into a state. One implementation, so two surfaces cannot disagree about
 * what the same facts mean — which is how "not configured" started rendering as an outage on one page
 * and as silence on another.
 *
 * Order matters and is deliberate: an explicit human pause wins over everything (it is intentional);
 * "never set up" beats "broken" (it is not broken); an unreachable control's FAIL MODE is the most
 * consequential fact there is, so it outranks partial coverage.
 */
export function stateFromProbe(facts: ProbeFacts): HonestState {
  if (facts.awaitingApproval) return 'awaiting-approval';
  if (facts.configured === false) return 'not-configured';
  if (facts.reachable === false) return facts.failMode === 'open' ? 'failed-open' : 'failed-closed';
  if (facts.experimental) return 'experimental';
  if (facts.partial) return 'degraded';
  return 'ready';
}

/**
 * The sentence for a status line, with the subject named. "Guardrails — failed open: …" reads as a fact
 * about a specific control; a bare badge does not.
 */
export function stateSentence(subject: string, state: HonestState): string {
  const d = describeState(state);
  return `${subject} — ${d.label.toLowerCase()}: ${d.meaning}`;
}
