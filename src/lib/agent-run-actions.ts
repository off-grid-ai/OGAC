// Pure policy for which management actions are valid against a run in a given status.
//
// SOLID seam: this module is ZERO-import, zero-I/O, unit-testable in isolation (like
// tenancy-policy.ts). The route handlers/store call it to decide whether an action is
// permitted before touching the db; the UI calls it to decide which buttons to show.
// The status vocabulary is the one produced by the interaction pipeline in lib/agentrun:
//   done | denied | blocked | pending_review | rejected | cancelled.

export type RunAction = 'rerun' | 'cancel' | 'delete' | 'review';

export type RunStatus =
  | 'done'
  | 'denied'
  | 'blocked'
  | 'pending_review'
  | 'rejected'
  | 'cancelled'
  | (string & {});

// A run is "in flight" (cancellable) only while it is awaiting a human decision — that is the one
// server-held, not-yet-terminal state the console can act on. Everything else is terminal.
const IN_FLIGHT: ReadonlySet<string> = new Set(['pending_review']);

// Terminal states can never be cancelled; a run can always be deleted and re-run, regardless of
// how it ended.
export function canCancel(status: RunStatus): boolean {
  return IN_FLIGHT.has(status);
}

export function canReview(status: RunStatus): boolean {
  return status === 'pending_review';
}

export function canDelete(_status: RunStatus): boolean {
  return true;
}

// Re-run just re-dispatches the same agent+input; valid for any recorded run.
export function canRerun(_status: RunStatus): boolean {
  return true;
}

// The full set of actions available for a run in the given status — drives both the UI
// (which buttons render) and the routes (guarding the mutation).
export function actionsFor(status: RunStatus): RunAction[] {
  const out: RunAction[] = [];
  if (canRerun(status)) out.push('rerun');
  if (canReview(status)) out.push('review');
  if (canCancel(status)) out.push('cancel');
  if (canDelete(status)) out.push('delete');
  return out;
}

export function isActionAllowed(action: RunAction, status: RunStatus): boolean {
  switch (action) {
    case 'rerun':
      return canRerun(status);
    case 'cancel':
      return canCancel(status);
    case 'delete':
      return canDelete(status);
    case 'review':
      return canReview(status);
    default:
      return false;
  }
}
