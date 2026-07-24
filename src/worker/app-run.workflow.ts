// Durable MULTI-STEP APP-RUN workflow — the mid-workflow HITL pause/resume engine (Builder Epic 2B).
//
// A Temporal workflow is DETERMINISTIC and runs inside a v8 sandbox: it may NOT do I/O, use fetch,
// read env, or import Node modules. It only ORCHESTRATES. Everything I/O (running a step against the
// governed pipeline / a connector / a guardrail, and persisting the run row) is delegated to
// ACTIVITIES (app-run.activities.ts). The pure SCHEDULER (app-run-plan.ts) is a plain function over
// plain data, so it is SAFE to call inside the workflow — the workflow uses it to decide which steps
// are runnable and to fold each step's result into the run state, deterministically.
//
// THE STEP LOOP (mirrors runApp in app-run.ts, but durable + pausable):
//   1. initState(spec) → the queued run state.
//   2. loop: nextRunnableSteps(spec, completed) — the steps whose predecessors are all done.
//   3. for each runnable step: mark running (fold + persist), then call executeStepActivity.
//   4. fold the StepResult via applyStepResult; persist.
//        • error          → halt: the run status is 'error', break out and return.
//        • awaiting_human  → PAUSE: block on condition() until a `resumeStep` signal for THAT step
//                            arrives, then fold the human decision (done/error + edited output) and
//                            continue. THIS is the mid-workflow HITL wait (risk #1) — the workflow
//                            suspends here durably; a worker/process restart resumes it from history.
//   5. when no step is runnable, the run is terminal — return its status.
//
// THE HITL SIGNAL (`resumeStep`): the console (adapters/apprun.ts → signalAppRun) sends this signal
// carrying { stepId, decision:'approve'|'reject', output? }. A queue of pending resumes lets a signal
// that races ahead of the pause still be consumed. approve → the step becomes 'done' (with any
// edited output); reject → the step becomes 'error' and the run halts.
//
// BUILD CAVEAT: Temporal's own worker bundles this file (Worker.create → workflowsPath), NOT tsup /
// webpack. Keep it self-contained: import ONLY from @temporalio/workflow and type-only / PURE code
// from src/lib (app-run-plan.ts is pure and import-clean). It is excluded from the Next build
// (next.config serverExternalPackages + worker alias:false) and must never be imported by a route.

import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  workflowInfo,
} from '@temporalio/workflow';
import type { AppSpec, AppStep } from '../lib/app-model';
import type { StepResult } from '../lib/app-run';
import type { AppRunWorkflowInput, AppRunWorkflowResult } from '../lib/app-run-durable';
import {
  initState,
  applyStepResult,
  nextRunnableSteps,
  completedStepIds,
  type AppRunState,
  type StepResultInput,
} from '../lib/app-run-plan';
import type { PipelineContract } from '../lib/pipeline-enforcement';
import type * as activities from './app-run.activities';
import { runInputForExecution } from '../lib/scheduled-run-id';

// ─── The resume signal payload (HITL decision from the console) ──────────────────────────────────
export interface ResumeStepDecision {
  stepId: string;
  decision: 'approve' | 'reject';
  /** Optional operator-edited output that overrides the step's produced output on approve. */
  output?: string;
  /** Optional short note recorded on the step detail. */
  note?: string;
  /** Authenticated reviewer identity supplied by the review route. */
  reviewer?: string;
}

/** Signal the console sends to resume a paused human step. */
export const resumeStepSignal = defineSignal<[ResumeStepDecision]>('resumeStep');

/** Query the current live run state (per-step status) — lets the console read the trace directly. */
export const runStateQuery = defineQuery<AppRunState>('runState');

function stepActivities(maxAttempts: number) {
  return proxyActivities<typeof activities>({
    // A single step can be long (an agent step is the full governed pipeline). Prize completion.
    startToCloseTimeout: '10 minutes',
    scheduleToCloseTimeout: '1 hour',
    retry: {
      initialInterval: '2s',
      backoffCoefficient: 2,
      maximumInterval: '1m',
      maximumAttempts: maxAttempts,
    },
  });
}

/**
 * The durable multi-step app-run workflow. Awaited by the client via handle.result(); the console
 * can also query 'runState' for the live per-step trace and signal 'resumeStep' to release a paused
 * human step.
 *
 * @param input   the app id/run id + resolved caller context + trigger input
 * @param maxAttempts Temporal retry attempts per step activity
 * @param specArg the AppSpec to execute (passed in by the submitter so the deterministic workflow
 *                never has to load it from the DB — loading is I/O). If omitted, an activity fetches
 *                it (the activity is the I/O boundary; the workflow's view stays deterministic).
 */
export async function AppRunWorkflow(
  submittedInput: AppRunWorkflowInput,
  maxAttempts = 3,
  specArg?: AppSpec,
): Promise<AppRunWorkflowResult> {
  const act = stepActivities(maxAttempts);
  const input = runInputForExecution(submittedInput, workflowInfo().runId);

  // Load the spec (via an activity — I/O) if the submitter didn't inline it.
  const spec = specArg ?? (await act.loadAppSpec(input.appId, input.orgId));
  if (!spec) {
    return { found: false, runId: input.runId, status: 'not_found' };
  }

  // PA-16 — resolve the bound-pipeline CONTRACT ONCE (via the I/O activity, using the SAME resolver
  // the inline route uses), then thread it into every step below so the WORKER path enforces the
  // data-allowlist ceiling + egress leash + governance overlay identically to inline. A deliberately
  // unbound app resolves to null; a stale explicit binding throws before step execution.
  const contract: PipelineContract | null = await act.resolveAppRunContractActivity(
    input.appId,
    input.pipelineId,
    input.orgId,
  );

  let state = initState(spec, input.runId);
  const results: StepResult[] = [];

  // Pending resume decisions keyed by stepId. A signal that arrives before (or during) the pause is
  // buffered here so the condition() below never deadlocks on a race.
  const pendingResumes = new Map<string, ResumeStepDecision>();
  setHandler(resumeStepSignal, (decision) => {
    pendingResumes.set(decision.stepId, decision);
  });
  setHandler(runStateQuery, () => state);

  await act.persistState(state, input.input, input.orgId);

  // Bounded outer loop: at most one pass per step (a validated DAG). Guards a pathological cycle.
  const maxIterations = (spec.steps?.length ?? 0) + 1;
  for (let i = 0; i <= maxIterations; i++) {
    const runnable = nextRunnableSteps(spec, completedStepIds(state));
    if (runnable.length === 0) break;

    let halted = false;
    for (const step of runnable) {
      // Mark running (for the live screen), then execute the step in an activity (I/O).
      state = applyStepResult(state, step.id, { status: 'running' });
      await act.persistState(state, input.input, input.orgId);

      const result = await act.executeStepActivity(input, spec, step, results, contract);
      results.push(result);
      state = applyStepResult(state, step.id, foldResult(result));
      await act.persistState(state, input.input, input.orgId);

      if (result.status === 'error') {
        halted = true;
        break;
      }

      if (result.status === 'awaiting_human') {
        // ─── THE MID-WORKFLOW HITL PAUSE (risk #1) ───────────────────────────────────────────────
        // Block DURABLY until a resume signal for THIS step arrives. condition() suspends the
        // workflow; Temporal persists history so a crash/restart resumes exactly here.
        await condition(() => pendingResumes.has(step.id));
        const decision = pendingResumes.get(step.id)!;
        pendingResumes.delete(step.id);

        const resolved = resolveHumanStep(step, decision, result);
        results[results.length - 1] = resolved; // replace the awaiting_human placeholder
        state = applyStepResult(state, step.id, foldResult(resolved));
        await act.persistState(state, input.input, input.orgId);

        if (resolved.status === 'error') {
          halted = true;
          break;
        }
        // approved → the step is now 'done'; fall through and re-evaluate runnable steps.
      }
    }
    if (halted) break;
  }

  return { found: true, runId: state.runId, status: state.status };
}

// ─── fold a StepResult into the reducer's input shape (pure) ──────────────────────────────────────
function foldResult(result: StepResult): StepResultInput {
  return {
    status: result.status,
    output: result.output,
    refs: result.refs,
    detail: result.detail,
    childRunId: result.childRunId,
    reviewer: result.reviewer,
    wouldPerform: result.wouldPerform,
    actionImpact: result.actionImpact,
    actionReceipt: result.actionReceipt,
    deliveryReceipt: result.deliveryReceipt,
  };
}

// ─── resolveHumanStep — apply a human decision to a paused step (pure) ────────────────────────────
// approve → 'done' with the (optionally edited) output carried forward for downstream steps.
// reject  → 'error', which halts the run (the reducer rolls the run up to 'error').
export function resolveHumanStep(
  step: AppStep,
  decision: ResumeStepDecision,
  paused: StepResult,
): StepResult {
  if (decision.decision === 'reject') {
    return {
      stepId: step.id,
      kind: 'human',
      status: 'error',
      detail: `human rejected at "${step.label || step.id}"${decision.note ? `: ${decision.note}` : ''}`,
      ...(decision.reviewer ? { reviewer: decision.reviewer } : {}),
    };
  }
  const output = decision.output !== undefined ? decision.output : paused.output;
  return {
    stepId: step.id,
    kind: 'human',
    status: 'done',
    output,
    detail: `human approved at "${step.label || step.id}"${decision.note ? `: ${decision.note}` : ''}`,
    ...(decision.reviewer ? { reviewer: decision.reviewer } : {}),
  };
}
