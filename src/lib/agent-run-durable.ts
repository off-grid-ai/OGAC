// Pure policy for DURABLE agent-run execution (Temporal). Zero-import, zero-I/O, unit-testable in
// isolation (like tenancy-policy.ts / agent-run-actions.ts). Everything here is a plain function
// over plain data: the routing decision (sync vs durable), the Temporal config resolution, the
// workflow-id derivation, and the status mapping from a durable workflow's lifecycle onto the
// run-status vocabulary the pipeline already uses.
//
// The I/O adapters that actually talk to Temporal (the client submitter + the worker that runs the
// pipeline activity) live in src/lib/adapters/agentruntime.ts and src/worker/agent-run.workflow.ts
// / activities.ts. This module holds only the decisions those adapters make, so they stay thin.

// ── Config ────────────────────────────────────────────────────────────────────────────────────

/** Resolved connection + queue config for the durable agent-run runtime. */
export interface DurableConfig {
  temporalAddress: string;
  namespace: string;
  taskQueue: string;
  /** Max Temporal retry attempts for the pipeline activity before the workflow fails. */
  maxAttempts: number;
}

/** Task queue the agent-run worker + client agree on. Distinct from the inference queue. */
export const AGENT_TASK_QUEUE = 'offgrid-agents';

/** Default Temporal frontend address for the on-prem fleet. */
export const DEFAULT_TEMPORAL_ADDRESS = 'offgrid-s1.local:7233';

// A source-of-env indirection so this module stays pure: callers pass the raw env map in, they
// don't reach into process.env here. Adapters call durableConfigFromEnv(process.env).
export interface EnvLike {
  OFFGRID_TEMPORAL_ADDRESS?: string;
  OFFGRID_TEMPORAL_NAMESPACE?: string;
  OFFGRID_AGENT_TASK_QUEUE?: string;
  OFFGRID_AGENT_MAX_ATTEMPTS?: string;
  OFFGRID_QUEUE_ENABLED?: string;
  OFFGRID_ADAPTER_AGENTRUNTIME?: string;
  // Index signature so process.env (Record<string, string|undefined>) is assignable to EnvLike.
  [key: string]: string | undefined;
}

/** Build a DurableConfig from an env map, applying the fleet defaults. */
export function durableConfigFromEnv(env: EnvLike = {}): DurableConfig {
  const n = (v: string | undefined, d: number): number => {
    const parsed = v == null ? NaN : Number(v);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : d;
  };
  return {
    temporalAddress: env.OFFGRID_TEMPORAL_ADDRESS?.trim() || DEFAULT_TEMPORAL_ADDRESS,
    namespace: env.OFFGRID_TEMPORAL_NAMESPACE?.trim() || 'default',
    taskQueue: env.OFFGRID_AGENT_TASK_QUEUE?.trim() || AGENT_TASK_QUEUE,
    maxAttempts: n(env.OFFGRID_AGENT_MAX_ATTEMPTS, 3),
  };
}

/**
 * Should an agent run be dispatched to the durable Temporal runtime? True only when the operator
 * has explicitly opted in — either OFFGRID_QUEUE_ENABLED=1 (the fleet-wide async toggle) or by
 * selecting the temporal runtime adapter directly. Any other value keeps the synchronous
 * in-process path, which is the graceful default: a missing/failed Temporal never breaks a run.
 */
export function durableEnabled(env: EnvLike = {}): boolean {
  return env.OFFGRID_QUEUE_ENABLED === '1' || env.OFFGRID_ADAPTER_AGENTRUNTIME === 'temporal';
}

// ── Workflow identity ───────────────────────────────────────────────────────────────────────

/**
 * Derive the Temporal workflowId for a run. It embeds the runId (already unique per submission) so
 * it is stable + idempotent: submitting the same runId twice reuses the same workflow rather than
 * spawning a duplicate. Kept ASCII/-safe for Temporal's id constraints.
 */
export function workflowIdFor(agentId: string, runId: string): string {
  const safeAgent = agentId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64);
  return `agentrun-${safeAgent}-${runId}`;
}

// ── Workflow I/O contract ─────────────────────────────────────────────────────────────────────

/** Input handed to AgentRunWorkflow (and through it to the pipeline activity). */
export interface AgentRunWorkflowInput {
  agentId: string;
  query: string;
  runId: string;
  caller?: string;
  requireReview?: boolean;
  orgId?: string;
}

/**
 * What the workflow/activity returns. The activity runs the real pipeline (runAgent) and persists,
 * so the durable side reports the persisted run's id + terminal status. A null run (unknown agent)
 * is reported as found:false so the route can 404 without the activity throwing.
 */
export interface AgentRunWorkflowResult {
  found: boolean;
  runId: string;
  status: string;
}

/** Validate + normalize a raw submission into a workflow input. Throws on missing required fields. */
export function toWorkflowInput(raw: {
  agentId?: unknown;
  query?: unknown;
  runId?: unknown;
  caller?: unknown;
  requireReview?: unknown;
  orgId?: unknown;
}): AgentRunWorkflowInput {
  if (typeof raw.agentId !== 'string' || !raw.agentId.trim()) {
    throw new Error('agentId required');
  }
  if (typeof raw.query !== 'string' || !raw.query.trim()) {
    throw new Error('query required');
  }
  if (typeof raw.runId !== 'string' || !raw.runId.trim()) {
    throw new Error('runId required');
  }
  return {
    agentId: raw.agentId,
    query: raw.query,
    runId: raw.runId,
    caller: typeof raw.caller === 'string' ? raw.caller : undefined,
    requireReview: raw.requireReview === true,
    orgId: typeof raw.orgId === 'string' && raw.orgId.trim() ? raw.orgId : undefined,
  };
}

// ── Status mapping ──────────────────────────────────────────────────────────────────────────

/**
 * Temporal's workflow-execution status enum (the subset we care about), as reported by
 * WorkflowHandle.describe(). We map it onto the run-status vocabulary so the console can display a
 * durable run's live state with the same statuses as a synchronous one.
 */
export type WorkflowExecutionStatus =
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'TERMINATED'
  | 'CONTINUED_AS_NEW'
  | 'TIMED_OUT'
  | 'UNSPECIFIED';

/**
 * Map a live Temporal workflow status onto the run-status vocabulary. Note: a COMPLETED workflow's
 * *run* status is whatever the pipeline persisted (done / denied / blocked / pending_review) — the
 * activity's result carries that. This function only covers the states visible BEFORE the result
 * is read, i.e. while polling, plus the failure/terminal cases where no run-status was persisted.
 */
export function statusFromWorkflow(s: WorkflowExecutionStatus): string {
  switch (s) {
    case 'RUNNING':
    case 'CONTINUED_AS_NEW':
      return 'running';
    case 'COMPLETED':
      // The persisted run holds the real terminal status; 'done' is the caller's fallback when it
      // hasn't yet read the workflow result.
      return 'done';
    case 'CANCELED':
    case 'TERMINATED':
      return 'cancelled';
    case 'FAILED':
    case 'TIMED_OUT':
      return 'failed';
    default:
      return 'queued';
  }
}

/** A run status is terminal (no more transitions) — mirrors agent-run-actions' terminal set. */
export function isTerminalStatus(status: string): boolean {
  return status !== 'queued' && status !== 'running' && status !== 'pending_review';
}
