// ─── Deciding many cases at once, safely ─────────────────────────────────────────────────────────────
//
// Seven near-identical reimbursements were seven separate round trips: open, read, approve, wait, find
// your place again. The most repetitive action in the product had no batch form.
//
// The reason to be careful is that this is a GOVERNED decision, not a list operation. Everything below
// exists to keep a batch from becoming a way to approve something nobody read. Pure. Zero IO.

export interface BulkCandidate {
  runId: string;
  appId: string;
  appTitle: string;
  /** The step awaiting a person. A case without one is not decidable. */
  pendingStepId: string | null;
  /** What the case is about, for the confirmation the person reads before committing. */
  label: string;
  /** Days it has been waiting — shown so a batch cannot silently include something long-forgotten. */
  daysWaiting: number;
}

export type BulkDecision = 'approve' | 'reject';

/**
 * The most cases one action may decide.
 *
 * Not a performance limit — a comprehension one. Past a screenful nobody is reading what they are
 * approving, and "select all" over hundreds is indistinguishable from not looking.
 */
export const MAX_BATCH = 25;

export interface BulkValidation {
  ok: boolean;
  errors: string[];
  /** The cases that would actually be decided. */
  eligible: BulkCandidate[];
  /** Cases dropped from the batch, each with the reason — never silently excluded. */
  skipped: { runId: string; reason: string }[];
}

/**
 * Check a batch before anything is committed.
 *
 * The one-app rule is the important one. Approving across two different processes in a single click is
 * how the wrong thing gets approved: the person is reading one context and acting on another. Batches
 * are therefore scoped to a single app, and a mixed selection is refused rather than silently split.
 */
export function validateBulk(
  selected: readonly BulkCandidate[],
  decision: BulkDecision,
  reason: string,
): BulkValidation {
  const errors: string[] = [];
  const skipped: { runId: string; reason: string }[] = [];

  const eligible = selected.filter((c) => {
    if (!c.pendingStepId) {
      // A case that already moved on is not an error — someone else got to it. Saying so is kinder
      // and more accurate than failing the whole batch.
      skipped.push({ runId: c.runId, reason: 'no longer waiting — somebody already decided it' });
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    errors.push('None of the selected cases are still waiting for a decision.');
  }
  if (eligible.length > MAX_BATCH) {
    errors.push(
      `That is ${eligible.length} cases. Decide at most ${MAX_BATCH} at a time — past that nobody is really reading what they approve.`,
    );
  }

  const apps = new Set(eligible.map((c) => c.appId));
  if (apps.size > 1) {
    errors.push(
      'These cases come from different processes. Decide one process at a time, so what you are approving is the thing you are looking at.',
    );
  }

  // Same rule as a single decision: taking something away requires saying why. A batch makes this MORE
  // important, not less — one sentence now explains twenty rejections later.
  if (decision === 'reject' && !reason.trim()) {
    errors.push('Say why these are being sent back. The reason is recorded on every one of them.');
  }

  return { ok: errors.length === 0, errors, eligible, skipped };
}

/** What the person is about to do, in a sentence they confirm. Never a bare count. */
export function describeBatch(
  eligible: readonly BulkCandidate[],
  decision: BulkDecision,
): string {
  if (eligible.length === 0) return 'Nothing selected.';
  const app = eligible[0].appTitle;
  const verb = decision === 'approve' ? 'Approve' : 'Send back';
  const oldest = Math.max(...eligible.map((c) => c.daysWaiting));
  const age =
    oldest >= 2 ? ` The oldest has been waiting ${oldest} days.` : '';
  return `${verb} ${eligible.length} case${eligible.length === 1 ? '' : 's'} in ${app}.${age}`;
}

export interface BulkOutcome {
  runId: string;
  ok: boolean;
  reason?: string;
}

/**
 * The report a person reads afterwards.
 *
 * A partial failure has to be loud. The dangerous version of this feature is one that says "20 approved"
 * when 3 of them silently did not take — the person walks away believing the queue is clear.
 */
export function summariseBulk(outcomes: readonly BulkOutcome[], decision: BulkDecision): string {
  const ok = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - ok;
  const verb = decision === 'approve' ? 'approved' : 'sent back';
  if (failed === 0) return `${ok} case${ok === 1 ? '' : 's'} ${verb}.`;
  if (ok === 0) return `None went through — all ${failed} failed. Nothing was ${verb}.`;
  return `${ok} ${verb}, but ${failed} did not go through and ${failed === 1 ? 'is' : 'are'} still waiting.`;
}
