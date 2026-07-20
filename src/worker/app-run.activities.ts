// Durable multi-step APP-RUN ACTIVITIES — the ONLY place the app-run workflow touches I/O.
//
// Activities run OUTSIDE the Temporal workflow sandbox, so the DB, gateway, and adapters are all
// fine here. These are THIN wrappers that reuse the EXISTING Phase 2A executor (executeStep in
// src/lib/app-run.ts) verbatim — the per-step governed pipeline / connector read / guardrail check
// is NOT duplicated. Durability + the HITL pause live in the workflow above; these activities just
// run one step, load a spec, and persist state.
//
// Relative (not "@/…") imports on purpose: the worker is a standalone process launched by tsx, and
// relative specifiers work without depending on an @/-alias resolver in that runtime (mirrors
// agent-run.activities.ts).

import type { AppSpec, AppStep } from '../lib/app-model';
import { runApp as _unusedRunApp, executeStep, defaultDeps } from '../lib/app-run';
import type { StepResult, AppRunContext, AppRunDeps } from '../lib/app-run';
import type { AppRunWorkflowInput } from '../lib/app-run-durable';
import type { AppRunState } from '../lib/app-run-plan';
import type { PipelineContract } from '../lib/pipeline-enforcement';

// Silence the unused re-export import (kept so the module and app-run.ts stay coupled at the type
// level; runApp itself is the inline path, not used by the durable worker).
void _unusedRunApp;

/**
 * Load an AppSpec by id (I/O). Returns null for an unknown app so the workflow can report not_found
 * without throwing. Only called when the submitter didn't inline the spec into the workflow input.
 */
export async function loadAppSpec(appId: string, orgId?: string): Promise<AppSpec | null> {
  const { getApp } = await import('../lib/apps-store');
  return getApp(appId, orgId ?? 'default');
}

/**
 * PA-16 — resolve the durable run's bound-pipeline CONTRACT (I/O), using the SAME resolver the inline
 * route uses (resolveContract in pipeline-contract.ts: getPipeline + org governance defaults + overlay
 * normalization). The workflow calls this ONCE up front and threads the resolved contract into every
 * step's executeStepActivity, so the WORKER path enforces the identical data-allowlist ceiling + egress
 * leash + policy/guardrail overlay the inline path does.
 *
 * A deliberately unbound app returns null. An explicit id that is missing, deprecated, or cannot be
 * resolved throws before any step activity runs. This is intentionally fail-closed: otherwise a
 * pipeline deleted between dispatch and worker execution would silently become an ungoverned run.
 */
export async function resolveContractActivity(
  pipelineId: string | null | undefined,
  orgId?: string,
): Promise<PipelineContract | null> {
  const { requireRunnablePipelineBinding, resolveExplicitPipelineBinding } =
    await import('../lib/pipeline-run-glue');
  return requireRunnablePipelineBinding(
    await resolveExplicitPipelineBinding(pipelineId, orgId ?? 'default'),
  ).contract;
}

/**
 * Revalidate the durable dispatch snapshot against the current App before any step executes.
 * Schedules and queued runs may wait for minutes or days, so the serialized pipeline id is evidence
 * of what was authorized at submission time, not an authority forever. A changed/deleted/cross-org
 * App or a stale pipeline fails closed here.
 */
export async function resolveAppRunContractActivity(
  appId: string,
  expectedPipelineId: string | null,
  orgId?: string,
): Promise<PipelineContract | null> {
  const resolvedOrgId = orgId ?? 'default';
  const { getApp } = await import('../lib/apps-store');
  const app = await getApp(appId, resolvedOrgId);
  const { requireRunnablePipelineBinding, resolveExplicitPipelineBinding } =
    await import('../lib/pipeline-run-glue');

  if (!app || (app.pipelineId ?? null) !== expectedPipelineId) {
    return requireRunnablePipelineBinding({
      state: 'invalid',
      pipelineId: expectedPipelineId,
      contract: null,
      code: 'binding_changed',
      reason: !app
        ? `App '${appId}' is no longer available in org '${resolvedOrgId}'.`
        : `App '${appId}' pipeline binding changed after durable submission.`,
    }).contract;
  }

  return requireRunnablePipelineBinding(
    await resolveExplicitPipelineBinding(expectedPipelineId, resolvedOrgId),
  ).contract;
}

/**
 * Execute ONE runnable step against the real platform (I/O), reusing executeStep verbatim. The
 * caller context is built from the workflow input so an agent step's child run attributes its
 * audit/trace/lineage identically to an inline run (mirrors runAgentPipeline's context threading).
 *
 * PA-16 — the resolved pipeline contract (from resolveContractActivity) is threaded onto ctx.contract
 * so executeStep's pure enforcement (enforceDataAccess / enforceModelCall) gates this WORKER step with
 * the SAME contract the inline route enforces. Null contract ⇒ legacy allow (unchanged).
 *
 * A human step returns { status:'awaiting_human' } WITHOUT blocking — the WORKFLOW owns the wait via
 * a condition()/signal. This activity never blocks on a human decision.
 *
 * Throws only on genuine infra failure so Temporal retries per the workflow's retry policy;
 * executeStep already turns a domain-level failure (unknown agent, blocked guardrail, unbound
 * domain) into a StepResult with status:'error', which is a normal result, not a throw.
 */
export async function executeStepActivity(
  input: AppRunWorkflowInput,
  spec: AppSpec,
  step: AppStep,
  priorResults: StepResult[],
  contract: PipelineContract | null = null,
  // Deps default to the real subsystems (as Temporal invokes it). Injectable so the enforcement is
  // unit-testable without a live DB/gateway — mirrors executeStep/runApp's dep-injection seam.
  deps: AppRunDeps = defaultDeps(),
): Promise<StepResult> {
  const ctx: AppRunContext = {
    orgId: input.orgId ?? 'default',
    actor: input.actor?.id ?? input.caller,
    runId: input.runId,
    contract,
    pipelineId: input.pipelineId ?? contract?.pipelineId ?? null,
    asker: input.asker,
    // Thread the run mode so a SHADOW durable run's side-effecting sinks NO-OP on the worker path
    // identically to the inline path (executeStep applies the pure shouldIntercept per step).
    mode: input.mode ?? 'live',
  };
  return executeStep(spec, step, priorResults, ctx, deps);
}

/**
 * Persist the live app-run state to the `app_runs` row (I/O) so screens 3 (RUNNING) + 4 (REVIEW)
 * read a real trace. Best-effort: swallows persistence errors so a DB blip never fails a durable run
 * (the workflow holds the authoritative state and Temporal history is the durable source of truth).
 */
export async function persistState(
  state: AppRunState,
  runInput: Record<string, unknown>,
  orgId?: string,
): Promise<void> {
  try {
    const { upsertAppRunState } = await import('../lib/app-run-store');
    await upsertAppRunState(state, runInput, orgId ?? 'default');
  } catch {
    /* app-run-store / DB unreachable — degrade to no-op; the workflow state is authoritative. */
  }
}
