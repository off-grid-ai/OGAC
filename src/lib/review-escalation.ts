// ─── Escalating a review — PURE ────────────────────────────────────────────────────────────────────
//
// ROADMAP §10 Flow 6 step 4: "Reviewer approves, edits, rejects, or escalates." Three of the four
// existed. Worse than missing: the review panel already TOLD the reviewer they could escalate —
// "You can reject or escalate this, but not approve it" — next to two buttons, Reject and Approve.
// The product named a capability it did not have, on the exact surface where a reviewer above their
// authority is stuck. §11's "honest product state" forbids that.
//
// WHAT ESCALATION IS, precisely, because the word is used loosely:
//   • The run STAYS paused at the same human step. Escalating is not a decision; it is a hand-off.
//   • The escalation records WHO handed it on, TO whom, and WHY, on the step itself, so the next
//     reviewer sees the reason rather than an anonymous item in a queue.
//   • It is reversible and repeatable: a second escalation appends, so a chain of hand-offs is visible.
//   • It never grants authority. If the first reviewer could not approve, escalating does not let them
//     approve — it puts the decision in front of someone who can.
//
// Zero I/O; the store applies what these rules produce.

export interface EscalationInput {
  /** Who is handing it on (the authenticated reviewer). */
  from: string;
  /** Who it goes to — an email/role/team the org understands. Optional: "up" is a valid destination. */
  to?: string | null;
  /** Why. Required — an escalation with no reason is an unexplained delay for the next person. */
  reason: string;
  at: string;
}

export interface EscalationRecord {
  from: string;
  to: string | null;
  reason: string;
  at: string;
}

export interface EscalationRefusal {
  ok: false;
  /** What to tell the reviewer. Never "invalid request". */
  reason: string;
}

export type EscalationDecision = { ok: true; record: EscalationRecord } | EscalationRefusal;

/** The statuses at which a hand-off is meaningful. Anything else is already decided. */
export function canEscalate(runStatus: string): boolean {
  return runStatus === 'awaiting_human';
}

/**
 * Validate and shape one escalation. A missing reason is refused with a sentence a reviewer can act on,
 * not a field name — this is the same discipline as the rest of the review surface.
 */
export function planEscalation(runStatus: string, input: EscalationInput): EscalationDecision {
  if (!canEscalate(runStatus)) {
    return {
      ok: false,
      reason: `This run is ${runStatus.replace('_', ' ')} — there is no pending decision to hand on.`,
    };
  }
  const reason = input.reason?.trim() ?? '';
  if (reason.length < 3) {
    return {
      ok: false,
      reason: 'Say why you are escalating — the next reviewer needs to know what you could not decide.',
    };
  }
  return {
    ok: true,
    record: {
      from: input.from,
      to: input.to?.trim() || null,
      reason: reason.slice(0, 500),
      at: input.at,
    },
  };
}

/** Append to an existing chain; the order is the order it happened. */
export function appendEscalation(
  existing: EscalationRecord[] | undefined,
  record: EscalationRecord,
): EscalationRecord[] {
  return [...(existing ?? []), record];
}

/** One line for the queue and the step header. Names the destination, because "escalated" alone is not information. */
export function describeEscalation(chain: EscalationRecord[] | undefined): string {
  if (!chain?.length) return '';
  const last = chain[chain.length - 1];
  const to = last.to ? ` to ${last.to}` : ' for a higher authority';
  const more = chain.length > 1 ? ` (${chain.length} hand-offs)` : '';
  return `Escalated by ${last.from}${to}${more} — ${last.reason}`;
}
