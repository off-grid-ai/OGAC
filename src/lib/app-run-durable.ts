// ─── Pure decisions for DURABLE app-run execution (Builder Epic Phase 2A) ───────────────────────
//
// Mirrors agent-run-durable.ts: zero-import*, zero-I/O, unit-testable decisions the Phase 2B durable
// workflow (worker/app-run.workflow.ts) + its submitter adapter will make. Everything here is a
// plain function over plain data — the routing decision (does this app NEED the durable path),
// workflow-id derivation, config resolution, and the pure helpers the workflow uses to advance a
// multi-step run.  (* one type-only import of AppSpec, erased at compile — safe in a Temporal bundle.)
//
// WHY a separate durability decision for apps: a single agent only needs Temporal when the operator
// opts into the async queue (durableEnabled). A multi-step app ALSO needs it whenever it can PAUSE
// — a `human` step suspends the run mid-workflow (HITL), and a suspended run must survive a process
// restart. `shouldRunDurably` encodes exactly that: multi-step OR has-a-human ⇒ durable required.

import type { AppSpec } from '@/lib/app-model';

// ── Config ───────────────────────────────────────────────────────────────────────────────────

/** Resolved connection + queue config for the durable app-run runtime. */
export interface AppDurableConfig {
  temporalAddress: string;
  namespace: string;
  taskQueue: string;
  /** Max Temporal retry attempts for a step activity before the workflow fails. */
  maxAttempts: number;
}

/** Task queue the app-run worker + client agree on. Distinct from the agent + inference queues. */
export const APP_TASK_QUEUE = 'offgrid-apps';

/** Default Temporal frontend address for the on-prem fleet. */
export const DEFAULT_TEMPORAL_ADDRESS = '127.0.0.1:7233';

// A source-of-env indirection so this module stays pure: callers pass the raw env map in.
export interface EnvLike {
  OFFGRID_TEMPORAL_ADDRESS?: string;
  OFFGRID_TEMPORAL_NAMESPACE?: string;
  OFFGRID_APP_TASK_QUEUE?: string;
  OFFGRID_APP_MAX_ATTEMPTS?: string;
  OFFGRID_QUEUE_ENABLED?: string;
  OFFGRID_ADAPTER_APPRUNTIME?: string;
  [key: string]: string | undefined;
}

/** Build an AppDurableConfig from an env map, applying the fleet defaults. */
export function appDurableConfigFromEnv(env: EnvLike = {}): AppDurableConfig {
  const n = (v: string | undefined, d: number): number => {
    const parsed = v == null ? Number.NaN : Number(v);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : d;
  };
  return {
    temporalAddress: env.OFFGRID_TEMPORAL_ADDRESS?.trim() || DEFAULT_TEMPORAL_ADDRESS,
    namespace: env.OFFGRID_TEMPORAL_NAMESPACE?.trim() || 'default',
    taskQueue: env.OFFGRID_APP_TASK_QUEUE?.trim() || APP_TASK_QUEUE,
    maxAttempts: n(env.OFFGRID_APP_MAX_ATTEMPTS, 3),
  };
}

// ── Durability routing decision ─────────────────────────────────────────────────────────────────

/** Does this spec contain any step that pauses the run for a person (HITL)? */
export function hasHumanStep(spec: AppSpec): boolean {
  return (spec.steps ?? []).some((s) => s.kind === 'human');
}

/** Is this a multi-step app (more than one step)? A single-step app is a "simple agent". */
export function isMultiStep(spec: AppSpec): boolean {
  return (spec.steps ?? []).length > 1;
}

/**
 * Should an app-run be driven by the DURABLE Temporal workflow rather than run inline to completion?
 *
 * True when the app is multi-step OR has a human step — either needs durability:
 *   • multi-step: several independently-governed steps whose intermediate state must survive a crash;
 *   • human step: the run PAUSES mid-workflow (awaiting_human) and must resume after any restart.
 *
 * A single agent-only app (isSimpleAgent) never needs the app-durable path here — it either runs
 * inline via runApp, or, if the operator enabled the async agent queue, rides the existing
 * agent-run durable path (agent-run-durable.ts) unchanged. So this decision is purely structural:
 * it does not consult env. (The submitter in 2B still checks Temporal availability before dispatch.)
 */
export function shouldRunDurably(spec: AppSpec): boolean {
  return isMultiStep(spec) || hasHumanStep(spec);
}

// ── Workflow identity ─────────────────────────────────────────────────────────────────────────

/**
 * Derive the Temporal workflowId for an app-run. Embeds the runId (unique per submission) so it is
 * stable + idempotent: submitting the same runId twice reuses the same workflow rather than spawning
 * a duplicate. Kept ASCII/-safe for Temporal's id constraints.
 */
export function appWorkflowIdFor(appId: string, runId: string): string {
  const safeApp = (appId ?? '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64) || 'app';
  return `apprun-${safeApp}-${runId}`;
}

// ── Workflow I/O contract (2B implements the workflow against this shape) ────────────────────────

import type { Actor } from '@/lib/audit-event';
import type { Asker } from '@/lib/retrieval/acl';

/**
 * Input handed to AppRunWorkflow (Phase 2B). Carries the resolved caller context (like
 * AgentRunWorkflowInput) so a durable app-run attributes its per-step child agent runs identically
 * to an inline run. All plain, JSON-serializable data so Temporal can carry it across boundaries.
 */
export interface AppRunWorkflowInput {
  appId: string;
  runId: string;
  input: Record<string, unknown>;
  orgId?: string;
  actor?: Actor;
  caller?: string;
  project?: string;
  asker?: Asker;
  /**
   * PA-16 — the bound-pipeline id this durable run must enforce (data-allowlist ceiling + egress
   * leash + policy/guardrail overlay). The dispatch site resolves it with the SAME resolver the
   * inline route uses (resolveExplicitPipelineBinding) and threads the plain id here; the workflow
   * re-resolves the full contract ONCE via an activity (the I/O boundary) and passes it into each
   * step's executeStepActivity — so the WORKER path enforces the identical contract the inline path
   * does. Null/absent means deliberately unbound; a stale explicit id fails closed in the activity.
   */
  pipelineId?: string | null;
  /**
   * SHADOW / LIVE run mode (BFSI blast-radius). The dispatch site resolves the effective mode
   * (app.shadowDefault ∨ requested) via the pure resolveRunMode and threads it here; the workflow
   * passes it into each executeStepActivity so a shadow run's side-effecting sinks NO-OP on the
   * WORKER path identically to the inline path. Absent ⇒ 'live' (default, additive).
   */
  mode?: 'shadow' | 'live';
}

/** What the app-run workflow reports back: the persisted run id + its terminal/paused status. */
export interface AppRunWorkflowResult {
  found: boolean;
  runId: string;
  status: string;
}

// ── Pure step-advance helpers the workflow uses ─────────────────────────────────────────────────

/** A run status is terminal for an APP-RUN (no more transitions without external input). Mirrors
 *  agent-run-durable's set, plus 'awaiting_human' is NON-terminal (a human decision resumes it). */
export function isTerminalAppStatus(status: string): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}

/** Does this status mean the workflow should PAUSE and wait for an external signal (HITL)? */
export function isPausedAppStatus(status: string): boolean {
  return status === 'awaiting_human';
}

/**
 * Given the set of step ids already completed, is the whole run finished (every step complete)?
 * Pure convenience so the workflow can decide to stop looping without re-deriving from state.
 */
export function allStepsComplete(spec: AppSpec, completedIds: Iterable<string>): boolean {
  const done = new Set(completedIds);
  const steps = spec.steps ?? [];
  return steps.length > 0 && steps.every((s) => done.has(s.id));
}
