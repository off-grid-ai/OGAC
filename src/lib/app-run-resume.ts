// ─── App-run INLINE resume (Builder Epic Phase 4A, HITL) — the loop-killer fix ────────────────────
//
// THE BUG THIS CLOSES: when an app run pauses at a `human` step but the durable Temporal worker is
// NOT running, the run executed INLINE (runApp stops at the first awaiting_human step). Clicking
// Approve then had nothing to signal, and the run stayed stuck forever with an infra-leaking error.
//
// THE FIX: resume the paused run IN-PROCESS. Given the app spec, the persisted paused AppRunState
// (rebuilt from the stored row via rebuildAppRunState), and the reviewer's decision, this:
//   • APPROVE → marks the awaiting human step `done` (carrying the reviewer's edited output if any),
//     then continues the SAME scheduler loop runApp uses (driveRunnableSteps — DRY) to run every
//     remaining downstream step to completion, or to the NEXT human pause.
//   • REJECT  → marks the human step terminal-non-success and finalizes the run as `cancelled`
//     WITHOUT running any downstream step.
//
// SOLID: this module is a THIN orchestrator over the PURE reducer (app-run-plan) + the shared step
// engine (app-run.driveRunnableSteps) + the injected AppRunDeps boundaries. It re-implements NO
// scheduling rule and duplicates NO execution loop. Persistence happens through deps.persist exactly
// as runApp does. Unit-testable end-to-end with injected deps (no live DB/gateway/Temporal).

import type { AppSpec } from '@/lib/app-model';
import {
  type AppRunContext,
  type AppRunDeps,
  type AppRunOutcome,
  type StepResult,
  defaultDeps,
  driveRunnableSteps,
} from '@/lib/app-run';
import {
  type AppRunState,
  type StepState,
  applyStepResult,
} from '@/lib/app-run-plan';

// The reviewer's decision, as the review route captures it (approve|reject + optional edit/note).
export interface ResumeDecision {
  decision: 'approve' | 'reject';
  /** The reviewer's edited output for the human step (carried forward as its output on approve). */
  output?: string;
  /** A free-text note recorded on the step detail (audit/context for downstream + the trace). */
  note?: string;
}

// ─── stepResultFromState — a completed step's StepState → the StepResult shape the engine threads ──
// The downstream-context threading (buildAgentQuery) + the aggregate outcome are computed from the
// StepResult[] of the steps that already ran. On a resume we only have the persisted StepState[], so
// we map the DONE steps (in order) back into StepResults. PURE — the inverse projection of what the
// reducer stored. Only completed (`done`) steps are threaded; a queued/errored step produced no
// output to carry forward.
export function stepResultFromState(s: StepState): StepResult {
  return {
    stepId: s.id,
    kind: s.kind,
    status: 'done',
    ...(s.output !== undefined ? { output: s.output } : {}),
    ...(s.refs !== undefined ? { refs: s.refs } : {}),
    ...(s.detail !== undefined ? { detail: s.detail } : {}),
    ...(s.childRunId !== undefined ? { childRunId: s.childRunId } : {}),
    ...(s.wouldPerform !== undefined ? { wouldPerform: s.wouldPerform } : {}),
  };
}

// The StepResults for every step already completed, in the persisted (topological) order — the
// context the downstream steps + the aggregate outcome are built from when the run resumes.
export function priorResultsFromState(state: AppRunState): StepResult[] {
  return state.steps.filter((s) => s.status === 'done').map(stepResultFromState);
}

// ─── resumeAppRun — apply the human decision, then continue the run inline ────────────────────────
// `state` MUST be the paused run's AppRunState (rebuildAppRunState of the stored row); `input` is the
// run's original trigger/form input (from the stored row) — threaded to deps.persist + downstream
// context exactly as runApp does. If the run is not actually paused at a human step, we finalize it
// as-is (defensive — the route guards via canReview, so this is a belt-and-braces no-op path). NEVER
// throws for a decision it understands.
export async function resumeAppRun(
  spec: AppSpec,
  state: AppRunState,
  input: Record<string, unknown>,
  decision: ResumeDecision,
  ctx: AppRunContext,
  deps: AppRunDeps = defaultDeps(),
): Promise<AppRunOutcome> {
  const pending = state.steps.find((s) => s.status === 'awaiting_human');

  // Defensive: nothing to resume. Return the run's current shape without touching it.
  if (!pending) {
    return {
      runId: state.runId,
      status: state.status === 'queued' ? 'done' : (state.status as AppRunOutcome['status']),
      steps: priorResultsFromState(state),
      outcome: aggregateOutcome(priorResultsFromState(state)),
    };
  }

  const noteSuffix = decision.note ? ` — note: ${decision.note}` : '';

  if (decision.decision === 'reject') {
    // Halt cleanly: mark the human step terminal-non-success, then finalize the whole run as
    // `cancelled` (the explicit terminal the reducer never derives + the view labels "Cancelled").
    // No downstream step runs. The reducer marks the step `error`; we then set the run to cancelled
    // explicitly (a reject is an operator decision, not a system failure).
    let next = applyStepResult(state, pending.id, {
      status: 'error',
      detail: `rejected by reviewer${noteSuffix}`,
    });
    next = { ...next, status: 'cancelled' };
    await deps.persist(next, input, ctx.orgId);
    const results = priorResultsFromState(next);
    return {
      runId: next.runId,
      status: 'cancelled',
      steps: results,
      outcome: aggregateOutcome(results),
    };
  }

  // APPROVE — mark the human step `done`, carrying the reviewer's edited output (falling back to the
  // step's own label so the step has a meaningful outcome), then continue the scheduler loop over the
  // remaining downstream steps via the SAME engine runApp uses (DRY).
  const approvedOutput =
    typeof decision.output === 'string' && decision.output.trim()
      ? decision.output
      : pending.output;
  const resumed = applyStepResult(state, pending.id, {
    status: 'done',
    ...(approvedOutput !== undefined ? { output: approvedOutput } : {}),
    detail: `approved by reviewer${noteSuffix}`,
  });
  await deps.persist(resumed, input, ctx.orgId);

  // Prior context = every step now done (includes the just-approved human step) so a downstream agent
  // sees the reviewer's decision + all upstream outputs, and the aggregate outcome spans the whole run.
  const priorResults = priorResultsFromState(resumed);
  return driveRunnableSteps(spec, resumed, priorResults, input, ctx, deps);
}

// The aggregate outcome = the LAST non-empty output produced (mirrors app-run.aggregateOutcome; kept
// local so this module has no cross-import for a one-liner and stays pure).
function aggregateOutcome(results: StepResult[]): string {
  for (let i = results.length - 1; i >= 0; i--) {
    const o = results[i].output;
    if (o?.trim()) return o;
  }
  return '';
}
