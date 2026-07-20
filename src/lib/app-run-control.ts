// ─── PURE decisions for durable APP-RUN workflow control (run-actions) ───────────────────────────
//
// Zero-import, zero-I/O eligibility rules for operator interventions on a durable app-run's Temporal
// workflow. Thin routes resolve the run, call this to decide whether the action is allowed for the
// run's current state, then delegate the actual Temporal control to the adapter. Keeping the
// decision pure makes "can I reset a running run?" unit-testable without a live cluster.
//
// The full operator matrix:
//   • cancel / terminate — stop work IN FLIGHT (running or paused at a human step). cancel is
//     graceful (the workflow observes it + runs cleanup); terminate force-kills.
//   • reset (replay)     — re-run a FINISHED workflow from its start, preserving audit history
//     (Temporal reset). Only meaningful once the workflow has terminated (its history exists).
//   • rerun (retry)      — dispatch a FRESH run from the same input. Also a terminal-state action;
//     the original run is untouched and a new run id is minted.

export type AppRunControlAction = 'cancel' | 'terminate' | 'reset' | 'rerun';

export const APP_RUN_CONTROL_ACTIONS: readonly AppRunControlAction[] = [
  'cancel',
  'terminate',
  'reset',
  'rerun',
];

/** In-flight states: work is still running or paused, so it can be stopped. */
const IN_FLIGHT = new Set(['queued', 'running', 'awaiting_human']);
/** Terminal states: the run has finished, so it can be replayed (reset) or re-dispatched (rerun). */
const TERMINAL = new Set(['done', 'error', 'cancelled']);

export interface AppRunControlDecision {
  allow: boolean;
  /** Present when denied — a plain operator-facing reason (route → 409). */
  reason?: string;
}

const VERB: Record<AppRunControlAction, string> = {
  cancel: 'cancel',
  terminate: 'terminate',
  reset: 'reset',
  rerun: 're-run',
};

/**
 * Decide whether a control action may be applied to an app run in the given status. PURE.
 *   • cancel / terminate → require an IN-FLIGHT run (nothing to stop otherwise).
 *   • reset / rerun      → require a TERMINAL run (replay/re-dispatch a finished run; a still-running
 *     run must be cancelled first, so replaying it is refused with a clear reason).
 */
export function decideAppRunControl(
  status: string,
  action: AppRunControlAction,
): AppRunControlDecision {
  const s = (status ?? '').trim();
  const verb = VERB[action];
  if (s === '') return { allow: false, reason: `cannot ${verb} a run with unknown status` };

  const stopping = action === 'cancel' || action === 'terminate';
  if (stopping) {
    if (IN_FLIGHT.has(s)) return { allow: true };
    return { allow: false, reason: `run is ${s}, not in flight — nothing to ${verb}` };
  }
  // reset / rerun
  if (TERMINAL.has(s)) return { allow: true };
  return {
    allow: false,
    reason: `run is ${s}, still in flight — ${verb} applies to a finished run (cancel it first)`,
  };
}

/** Normalize an untrusted request action; unknown → null so the route rejects it (400). */
export function parseAppRunControlAction(raw: unknown): AppRunControlAction | null {
  return typeof raw === 'string' && (APP_RUN_CONTROL_ACTIONS as readonly string[]).includes(raw)
    ? (raw as AppRunControlAction)
    : null;
}

/** The actions offered for a run in a given status — drives which buttons the UI renders. PURE. */
export function availableAppRunControls(status: string): AppRunControlAction[] {
  return APP_RUN_CONTROL_ACTIONS.filter((a) => decideAppRunControl(status, a).allow);
}
