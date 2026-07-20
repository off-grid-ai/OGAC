// ─── PURE decisions for durable APP-RUN workflow control (run-actions) ───────────────────────────
//
// Zero-import, zero-I/O eligibility rules for operator interventions on a durable app-run's Temporal
// workflow: cancel (graceful) and terminate (force). The thin route (api/.../app-runs/[id]/cancel)
// resolves the run, calls this to decide whether the action is allowed for the run's current state,
// then delegates the actual Temporal control to the generic cancelWorkflow adapter. Keeping the
// decision pure makes "can I cancel a done run?" unit-testable without a live cluster.

export type AppRunControlAction = 'cancel' | 'terminate';

/** The run states on which a durable workflow control action is meaningful (work is still in flight). */
const CONTROLLABLE_STATES = new Set(['running', 'awaiting_human']);

export interface AppRunControlDecision {
  allow: boolean;
  /** Present when denied — a plain operator-facing reason (route → 409). */
  reason?: string;
}

/**
 * Decide whether a control action may be applied to an app run in the given status. Cancel and
 * terminate both require the run to still be in flight (running or paused at a human step); a
 * terminal run (done/error/cancelled) or an unknown status is refused with a clear reason. PURE.
 */
export function decideAppRunControl(
  status: string,
  action: AppRunControlAction,
): AppRunControlDecision {
  const s = (status ?? '').trim();
  if (CONTROLLABLE_STATES.has(s)) return { allow: true };
  const verb = action === 'terminate' ? 'terminate' : 'cancel';
  if (s === '') return { allow: false, reason: `cannot ${verb} a run with unknown status` };
  return {
    allow: false,
    reason: `run is ${s}, not in flight — nothing to ${verb}`,
  };
}

/** Normalize an untrusted request mode into the two supported control actions (default: cancel). */
export function parseAppRunControlAction(raw: unknown): AppRunControlAction {
  return raw === 'terminate' ? 'terminate' : 'cancel';
}
