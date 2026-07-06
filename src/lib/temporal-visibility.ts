// Pure shaping for Temporal WORKFLOW VISIBILITY. Zero-import, zero-I/O, unit-testable in isolation
// (like tenancy-policy.ts / agent-run-durable.ts). The I/O adapter that actually lists/describes
// executions against a live Temporal cluster lives in src/lib/adapters/agentruntime.ts; it feeds
// the *representative shapes* below into these functions so all the normalization/derivation stays
// pure and testable without a cluster.
//
// This is the read side of durable execution: turning Temporal's WorkflowExecutionInfo / describe()
// responses into a stable, JSON-safe row the console renders — distinct from the DB run records
// (agent-runs-store) which hold the pipeline's own timeline. We correlate the two by runId, which
// the durable workflowId embeds (see workflowIdFor).

import { statusFromWorkflow, type WorkflowExecutionStatus } from './agent-run-durable';

// Re-export so the read-side consumers (routes, the Jobs UI) get the status union + action gating
// from one module without reaching into agent-run-durable's execution-policy surface.
export type { WorkflowExecutionStatus };

// ── Input shapes (the subset of the Temporal client responses we consume) ─────────────────────
// Declared locally so this module imports nothing from @temporalio. The adapter maps the real
// client objects onto these before calling in — a thin seam that keeps the pure part cluster-free.

/** Subset of @temporalio/client WorkflowExecutionInfo we read from client.workflow.list(). */
export interface RawWorkflowExecutionInfo {
  workflowId: string;
  runId?: string;
  type?: string;
  /** Status name string, e.g. 'RUNNING' | 'COMPLETED' … (the client exposes .status.name). */
  status?: string;
  startTime?: Date | string | number | null;
  closeTime?: Date | string | number | null;
  historyLength?: number | bigint | null;
  taskQueue?: string;
}

/** Subset of a WorkflowHandle.describe() result plus (optionally) a decoded result payload. */
export interface RawWorkflowDescription {
  workflowId: string;
  runId?: string;
  type?: string;
  status?: string;
  startTime?: Date | string | number | null;
  closeTime?: Date | string | number | null;
  historyLength?: number | bigint | null;
  taskQueue?: string;
}

// ── Output shapes (JSON-safe, what the route/UI consume) ───────────────────────────────────────

export interface WorkflowExecutionRow {
  workflowId: string;
  /** Temporal execution runId (a UUID per attempt) — NOT the console runId. */
  executionRunId?: string;
  type?: string;
  /** Raw Temporal status name (RUNNING / COMPLETED / …). */
  temporalStatus: WorkflowExecutionStatus;
  /** Temporal status mapped onto the console's run-status vocabulary (running/done/failed/…). */
  status: string;
  startTime?: string;
  closeTime?: string;
  historyLength?: number;
  taskQueue?: string;
  /** The console runId parsed out of the workflowId, when this is an agent-run workflow. */
  runId?: string;
}

export interface WorkflowExecutionsView {
  object: 'temporal_workflow_executions';
  configured: boolean;
  reachable: boolean;
  /** Human note when Temporal is unconfigured/unreachable — the UI shows this instead of throwing. */
  note?: string;
  executions: WorkflowExecutionRow[];
  /** Count by mapped run-status, for the filter chips. */
  statusCounts: Record<string, number>;
}

// ── Normalization ─────────────────────────────────────────────────────────────────────────────

/** Coerce Temporal's status name (possibly unknown) into the WorkflowExecutionStatus union. */
export function normalizeWorkflowStatus(name: string | undefined): WorkflowExecutionStatus {
  const known: WorkflowExecutionStatus[] = [
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'CANCELED',
    'TERMINATED',
    'CONTINUED_AS_NEW',
    'TIMED_OUT',
    'UNSPECIFIED',
  ];
  const up = (name ?? '').toUpperCase().replace(/[\s-]+/g, '_');
  return (known.find((k) => k === up) ?? 'UNSPECIFIED') as WorkflowExecutionStatus;
}

/** Convert a Date/string/number/bigint timestamp to an ISO string, or undefined. */
function toIso(v: Date | string | number | null | undefined): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return isNaN(v.getTime()) ? undefined : v.toISOString();
  if (typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  // string — accept ISO directly, else try to parse.
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toNum(v: number | bigint | null | undefined): number | undefined {
  if (v == null) return undefined;
  return typeof v === 'bigint' ? Number(v) : v;
}

/**
 * Parse the console runId out of an agent-run workflowId. The id is `agentrun-<agent>-<runId>`
 * (see workflowIdFor). Since the agent segment can itself contain '-', we anchor on the known
 * prefix and take everything after the LAST '-' as the runId, matching how workflowIdFor appends
 * it. Returns undefined for non-agent-run workflows.
 */
export function runIdFromWorkflowId(workflowId: string): string | undefined {
  if (!workflowId.startsWith('agentrun-')) return undefined;
  const idx = workflowId.lastIndexOf('-');
  if (idx < 0 || idx === workflowId.length - 1) return undefined;
  return workflowId.slice(idx + 1);
}

/** Shape one raw execution-info record into a JSON-safe row. */
export function shapeExecution(raw: RawWorkflowExecutionInfo): WorkflowExecutionRow {
  const temporalStatus = normalizeWorkflowStatus(raw.status);
  return {
    workflowId: raw.workflowId,
    executionRunId: raw.runId,
    type: raw.type,
    temporalStatus,
    status: statusFromWorkflow(temporalStatus),
    startTime: toIso(raw.startTime),
    closeTime: toIso(raw.closeTime),
    historyLength: toNum(raw.historyLength),
    taskQueue: raw.taskQueue,
    runId: runIdFromWorkflowId(raw.workflowId),
  };
}

/** Build the full executions view from a list of raw records. Pure — no cluster, no db. */
export function buildExecutionsView(
  raws: RawWorkflowExecutionInfo[],
  opts: { configured: boolean; reachable: boolean; note?: string } = { configured: false, reachable: false },
): WorkflowExecutionsView {
  const executions = raws.map(shapeExecution);
  const statusCounts: Record<string, number> = {};
  for (const e of executions) statusCounts[e.status] = (statusCounts[e.status] ?? 0) + 1;
  return {
    object: 'temporal_workflow_executions',
    configured: opts.configured,
    reachable: opts.reachable,
    note: opts.note,
    executions,
    statusCounts,
  };
}

// ── Detail (single workflow) ─────────────────────────────────────────────────────────────────

export interface WorkflowDetail {
  object: 'temporal_workflow_detail';
  workflowId: string;
  found: boolean;
  execution?: WorkflowExecutionRow;
  /** Terminal/interim result payload, when the workflow has one (JSON-safe). */
  result?: unknown;
  /** When not found or Temporal unreachable. */
  note?: string;
}

/** Shape a describe() response (+ optional decoded result) into the detail view. */
export function buildWorkflowDetail(
  raw: RawWorkflowDescription | null,
  result: unknown,
  opts: { note?: string } = {},
): WorkflowDetail {
  if (!raw) {
    return {
      object: 'temporal_workflow_detail',
      workflowId: '',
      found: false,
      note: opts.note ?? 'workflow not found',
    };
  }
  return {
    object: 'temporal_workflow_detail',
    workflowId: raw.workflowId,
    found: true,
    execution: shapeExecution(raw),
    result,
    note: opts.note,
  };
}

/**
 * Build the Temporal-list query string that scopes visibility to agent-run workflows.
 * Temporal's visibility query language: `WorkflowType = 'AgentRunWorkflow'`. Kept pure so it's
 * testable; the adapter passes it to client.workflow.list({ query }).
 */
export function agentRunListQuery(): string {
  return `WorkflowType = 'AgentRunWorkflow'`;
}

// ── Job-action gating (pure predicates over Temporal status) ───────────────────────────────────
// The console's Jobs surface offers rerun + cancel on a durable execution. These pure predicates
// decide which action a given workflow status admits, so the route and UI agree without either
// reaching into a cluster. Mirrors agent-run-actions' state-machine, but over Temporal states.

/**
 * A workflow execution can be CANCELLED/TERMINATED only while it is still open (RUNNING /
 * CONTINUED_AS_NEW). Closed workflows (completed/failed/canceled/terminated/timed-out) are already
 * terminal — cancelling them is a no-op the UI shouldn't offer.
 */
export function canCancelWorkflow(status: WorkflowExecutionStatus): boolean {
  return status === 'RUNNING' || status === 'CONTINUED_AS_NEW';
}

/**
 * A workflow can be RE-RUN only once it has CLOSED — rerunning a still-running job would double up.
 * Any terminal Temporal state (COMPLETED / FAILED / CANCELED / TERMINATED / TIMED_OUT) is rerunnable;
 * an open or unknown state is not.
 */
export function canRerunWorkflow(status: WorkflowExecutionStatus): boolean {
  switch (status) {
    case 'COMPLETED':
    case 'FAILED':
    case 'CANCELED':
    case 'TERMINATED':
    case 'TIMED_OUT':
      return true;
    default:
      return false;
  }
}

/** The set of actions a durable execution row admits, given its Temporal status. Pure — drives
 *  both the UI button visibility and the route's guard. */
export interface WorkflowActions {
  rerun: boolean;
  cancel: boolean;
}
export function workflowActionsFor(status: WorkflowExecutionStatus): WorkflowActions {
  return { rerun: canRerunWorkflow(status), cancel: canCancelWorkflow(status) };
}
