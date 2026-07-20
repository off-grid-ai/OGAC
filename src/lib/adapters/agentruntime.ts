import { randomUUID } from 'node:crypto';
import {
  type AgentRunWorkflowInput,
  type AgentRunWorkflowResult,
  type DurableConfig,
  durableConfigFromEnv,
  durableEnabled,
  statusFromWorkflow,
  type WorkflowExecutionStatus,
  workflowIdFor,
} from '@/lib/agent-run-durable';
import {
  buildSchedulesView,
  type RawScheduleDescription,
  type ScheduleSpec,
  ownsSchedule,
  scheduleRunIdSeed,
  type SchedulesView,
} from '@/lib/temporal-schedules';
import {
  agentRunListQuery,
  buildExecutionsView,
  buildWorkflowDetail,
  type RawWorkflowDescription,
  type RawWorkflowExecutionInfo,
  type WorkflowDetail,
  type WorkflowExecutionsView,
} from '@/lib/temporal-visibility';
import type { AdapterMeta } from './types';

// Agent-runtime adapters — the seam that decides HOW an agent run executes. The default is
// synchronous, in-process (runAgent in src/lib/agentrun.ts). The Temporal adapter is a durable
// swap-in: long-running / retryable / resumable agent workflows submitted to a Temporal cluster.
//
// The Temporal client speaks gRPC (:7233). We bind @temporalio/client here via a DYNAMIC import so
// the dep never enters the default Next build/bundle (next.config aliases @temporalio/worker to
// false for webpack; the client is a serverExternalPackage, required at runtime only when durable
// mode is actually selected). If the connection fails, submit() reports submitted:false and the
// caller falls through to the synchronous in-process path — selecting Temporal NEVER breaks a run.
//
// Config (all optional; fleet defaults applied in agent-run-durable.ts):
//   OFFGRID_QUEUE_ENABLED=1 | OFFGRID_ADAPTER_AGENTRUNTIME=temporal — opt into durable dispatch
//   OFFGRID_TEMPORAL_ADDRESS (host:7233, default 127.0.0.1:7233)
//   OFFGRID_TEMPORAL_NAMESPACE (default 'default'), OFFGRID_AGENT_TASK_QUEUE (default offgrid-agents)

export interface DurableRunHandle {
  runId: string;
  workflowId: string;
  mode: 'sync' | 'durable';
  submitted: boolean;
  /** Terminal/interim run status when known (durable submit that awaited or polled). */
  status?: string;
  note?: string;
}

export interface AgentRuntimePort {
  meta: AdapterMeta;
  // True when durable dispatch is CONFIGURED (opted in). Whether the cluster is actually reachable
  // is discovered at submit-time — a submit that can't reach Temporal reports submitted:false.
  available(): boolean;
  // Submit an agent run for durable execution and await its result. Returns a handle; MUST NOT
  // throw — a runtime that can't accept/complete the run reports submitted:false and the caller
  // runs it synchronously instead.
  submit(input: AgentRunWorkflowInput): Promise<DurableRunHandle>;
  health(): Promise<boolean>;
}

// Default: no durable runtime. runAgent executes in-process and this simply acknowledges sync mode.
export const syncRuntime: AgentRuntimePort = {
  meta: {
    id: 'sync',
    capability: 'sandbox',
    vendor: 'First-party',
    license: 'first-party',
    render: 'headless',
    description: 'Synchronous in-process agent execution (default). No external runtime.',
  },
  available: () => true,
  submit: ({ agentId, query, runId }) =>
    Promise.resolve({
      runId,
      workflowId: `${agentId}:${runId}`,
      mode: 'sync',
      submitted: false,
      note: 'synchronous in-process execution',
    }),
  health: () => Promise.resolve(true),
};

// A cached Temporal Client keyed by address/namespace so repeated submits reuse one gRPC channel.
let cachedClient: { key: string; client: import('@temporalio/client').Client } | null = null;

async function temporalClient(cfg: DurableConfig): Promise<import('@temporalio/client').Client> {
  const key = `${cfg.temporalAddress}/${cfg.namespace}`;
  if (cachedClient?.key === key) return cachedClient.client;
  // Dynamic import: keeps @temporalio/client out of the default Next bundle.
  const { Connection, Client } = await import('@temporalio/client');
  const connection = await Connection.connect({ address: cfg.temporalAddress });
  const client = new Client({ connection, namespace: cfg.namespace });
  cachedClient = { key, client };
  return client;
}

export const temporalRuntime: AgentRuntimePort = {
  meta: {
    id: 'temporal',
    capability: 'sandbox',
    vendor: 'Temporal',
    license: 'MIT',
    render: 'headless',
    embedUrl: process.env.OFFGRID_TEMPORAL_UI_URL,
    description:
      'Durable agent workflows submitted to a Temporal cluster (:7233). Retryable/resumable runs.',
  },
  available: () => durableEnabled(process.env),
  async submit(input) {
    const cfg = durableConfigFromEnv(process.env);
    const workflowId = workflowIdFor(input.agentId, input.runId);
    try {
      const client = await temporalClient(cfg);
      // Idempotent start: reusing the same workflowId for a given runId won't spawn a duplicate.
      await client.workflow.start('AgentRunWorkflow', {
        taskQueue: cfg.taskQueue,
        workflowId,
        args: [input, cfg.maxAttempts],
      });
      const handle = client.workflow.getHandle(workflowId);
      // Await the durable result. The workflow runs the real pipeline in the worker and persists;
      // its result carries the persisted run's terminal status. If the worker is slow/down the
      // workflow simply sits in the queue durably — but the console request would block, so we
      // bound the await and, on timeout, return a 'running' handle the UI/poller can follow.
      const result = await withTimeout(
        handle.result() as Promise<AgentRunWorkflowResult>,
        awaitBudgetMs(),
      );
      if (result === TIMED_OUT) {
        const wfStatus = await handle
          .describe()
          .then((d) => d.status.name as WorkflowExecutionStatus)
          .catch(() => 'RUNNING' as const);
        return {
          runId: input.runId,
          workflowId,
          mode: 'durable',
          submitted: true,
          status: statusFromWorkflow(wfStatus),
          note: 'workflow started; result pending',
        };
      }
      return {
        runId: result.runId,
        workflowId,
        mode: 'durable',
        submitted: true,
        status: result.found ? result.status : 'not_found',
      };
    } catch (e) {
      // Any failure to reach/submit to Temporal → fall back to the synchronous path.
      return {
        runId: input.runId,
        workflowId,
        mode: 'sync',
        submitted: false,
        note: (e as Error).message,
      };
    }
  },
  async health() {
    if (!durableEnabled(process.env)) return false;
    const cfg = durableConfigFromEnv(process.env);
    try {
      const { Connection } = await import('@temporalio/client');
      const connection = await Connection.connect({ address: cfg.temporalAddress });
      await connection.workflowService.getSystemInfo({});
      return true;
    } catch {
      return false;
    }
  },
};

// ── await helpers ───────────────────────────────────────────────────────────────────────────
const TIMED_OUT = Symbol('timed-out');
function awaitBudgetMs(): number {
  const v = Number(process.env.OFFGRID_AGENT_AWAIT_MS ?? '25000');
  return Number.isFinite(v) && v > 0 ? v : 25000;
}
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return Promise.race([
    p,
    new Promise<typeof TIMED_OUT>((resolve) => {
      const t = setTimeout(() => resolve(TIMED_OUT), ms);
      t.unref?.();
    }),
  ]);
}

export const AGENT_RUNTIME_PORTS: AgentRuntimePort[] = [syncRuntime, temporalRuntime];

// Select the active runtime. Durable is chosen when it's configured/opted-in; otherwise sync. The
// caller still treats a submitted:false handle as "run synchronously", so this only reflects intent.
export function getAgentRuntime(): AgentRuntimePort {
  const wanted = process.env.OFFGRID_ADAPTER_AGENTRUNTIME;
  if (wanted && wanted !== 'temporal') {
    return AGENT_RUNTIME_PORTS.find((p) => p.meta.id === wanted) ?? syncRuntime;
  }
  return temporalRuntime.available() ? temporalRuntime : syncRuntime;
}

// ── Workflow visibility (read side) ───────────────────────────────────────────────────────────
// I/O bridge over @temporalio/client. Maps the client's WorkflowExecutionInfo / describe() objects
// onto the raw shapes the PURE temporal-visibility module normalizes. NEVER throws — Temporal
// unreachable/unconfigured returns an empty, configured/reachable-flagged view with a note.

const NOT_CONFIGURED =
  'Durable runtime not enabled — set OFFGRID_QUEUE_ENABLED=1 or OFFGRID_ADAPTER_AGENTRUNTIME=temporal.';

/** List recent AgentRunWorkflow executions from Temporal's visibility store. */
export async function listWorkflowExecutions(limit = 50): Promise<WorkflowExecutionsView> {
  if (!durableEnabled(process.env)) {
    return buildExecutionsView([], { configured: false, reachable: false, note: NOT_CONFIGURED });
  }
  const cfg = durableConfigFromEnv(process.env);
  try {
    const client = await temporalClient(cfg);
    const raws: RawWorkflowExecutionInfo[] = [];
    // client.workflow.list yields an async iterable of WorkflowExecutionInfo. Scope to our workflow
    // type via the visibility query; bound the scan by `limit` so a huge history doesn't stream in.
    for await (const wf of client.workflow.list({ query: agentRunListQuery() })) {
      raws.push({
        workflowId: wf.workflowId,
        runId: wf.runId,
        type: wf.type,
        status: wf.status?.name,
        startTime: wf.startTime,
        closeTime: wf.closeTime,
        historyLength: wf.historyLength,
        taskQueue: wf.taskQueue,
      });
      if (raws.length >= limit) break;
    }
    return buildExecutionsView(raws, { configured: true, reachable: true });
  } catch (e) {
    return buildExecutionsView([], {
      configured: true,
      reachable: false,
      note: `Temporal unreachable: ${(e as Error).message}`,
    });
  }
}

/** Fetch a single workflow's status/result summary by workflowId. */
export async function describeWorkflow(workflowId: string): Promise<WorkflowDetail> {
  if (!durableEnabled(process.env)) {
    return buildWorkflowDetail(null, undefined, { note: NOT_CONFIGURED });
  }
  const cfg = durableConfigFromEnv(process.env);
  try {
    const client = await temporalClient(cfg);
    const handle = client.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    const raw: RawWorkflowDescription = {
      workflowId: desc.workflowId,
      runId: desc.runId,
      type: desc.type,
      status: desc.status?.name,
      startTime: desc.startTime,
      closeTime: desc.closeTime,
      historyLength: desc.historyLength,
      taskQueue: desc.taskQueue,
    };
    // Only a closed workflow has a result; reading it on a running one would block. Guard by status.
    let result: unknown;
    if (desc.status?.name === 'COMPLETED') {
      result = await handle.result().catch(() => undefined);
    }
    return buildWorkflowDetail(raw, result);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    // A missing workflow is a clean not-found, not an error to surface as unreachable.
    const notFound = /not found|no execution|WorkflowNotFound/i.test(msg);
    return buildWorkflowDetail(null, undefined, {
      note: notFound ? 'workflow not found' : `Temporal unreachable: ${msg}`,
    });
  }
}

// ── Workflow control (cancel / terminate) ──────────────────────────────────────────────────────
// The write side of durable execution: stop an in-flight job. `cancel` requests a graceful
// cancellation (the workflow observes it and can run cleanup); `terminate` force-kills it. Both
// return { ok, error? } so the thin route maps success/failure without either throwing.

export interface WorkflowMutationResult {
  ok: boolean;
  workflowId?: string;
  /** 'not_found' when the workflow id doesn't exist (route → 404), else undefined. */
  reason?: 'not_found' | 'unreachable' | 'not_configured';
  error?: string;
}

/**
 * Cancel or terminate a running workflow by id. `mode: 'terminate'` force-kills; the default
 * `'cancel'` requests graceful cancellation. NEVER throws — Temporal unconfigured/unreachable or a
 * missing workflow is reported in the result for the route to translate to a status code.
 */
export async function cancelWorkflow(
  workflowId: string,
  mode: 'cancel' | 'terminate' = 'cancel',
): Promise<WorkflowMutationResult> {
  if (!durableEnabled(process.env))
    return { ok: false, reason: 'not_configured', error: NOT_CONFIGURED };
  const cfg = durableConfigFromEnv(process.env);
  try {
    const client = await temporalClient(cfg);
    const handle = client.workflow.getHandle(workflowId);
    if (mode === 'terminate') await handle.terminate('terminated from console');
    else await handle.cancel();
    return { ok: true, workflowId };
  } catch (e) {
    const msg = (e as Error).message ?? '';
    const notFound = /not found|no execution|WorkflowNotFound/i.test(msg);
    return {
      ok: false,
      reason: notFound ? 'not_found' : 'unreachable',
      error: notFound ? 'workflow not found' : `Temporal unreachable: ${msg}`,
    };
  }
}

/**
 * Reset (REPLAY) a finished workflow: re-run it from the first workflow task, preserving the audit
 * history as a new run of the same workflow id. We locate the first WorkflowTaskCompleted event
 * (identified by its attribute presence, robust to the enum's wire form) and reset to it. Signals
 * are reapplied by default, so a HITL workflow replays through its recorded approval to completion.
 * NEVER throws — unconfigured/unreachable/missing-workflow is reported in the result.
 */
export async function resetWorkflow(workflowId: string): Promise<WorkflowMutationResult> {
  if (!durableEnabled(process.env))
    return { ok: false, reason: 'not_configured', error: NOT_CONFIGURED };
  const cfg = durableConfigFromEnv(process.env);
  try {
    const client = await temporalClient(cfg);
    const desc = await client.workflow.getHandle(workflowId).describe();
    const runId = desc.runId;
    const hist = await client.workflowService.getWorkflowExecutionHistory({
      namespace: cfg.namespace,
      execution: { workflowId, runId },
    });
    const events = hist.history?.events ?? [];
    const firstTask = events.find((e) => e.workflowTaskCompletedEventAttributes != null);
    if (!firstTask?.eventId) {
      return { ok: false, reason: 'unreachable', error: 'no completed workflow task to reset to' };
    }
    await client.workflowService.resetWorkflowExecution({
      namespace: cfg.namespace,
      workflowExecution: { workflowId, runId },
      reason: 'reset (replay) from console',
      workflowTaskFinishEventId: firstTask.eventId,
      requestId: randomUUID(),
    });
    return { ok: true, workflowId };
  } catch (e) {
    const msg = (e as Error).message ?? '';
    const notFound = /not found|no execution|WorkflowNotFound|workflow execution already/i.test(msg);
    return {
      ok: false,
      reason: notFound ? 'not_found' : 'unreachable',
      error: notFound ? 'workflow not found' : `Temporal unreachable: ${msg}`,
    };
  }
}

// ── Schedules (recurring agent runs) ──────────────────────────────────────────────────────────
// I/O bridge over @temporalio/client ScheduleClient. Create/list/pause/unpause/delete Temporal
// Schedules that fire AgentRunWorkflow on a cron spec. All shaping/validation is pure (see
// temporal-schedules.ts). List NEVER throws; the mutating ops return { ok, error? } for the route.

export async function listSchedules(orgId: string): Promise<SchedulesView> {
  if (!durableEnabled(process.env)) {
    return buildSchedulesView([], { configured: false, reachable: false, note: NOT_CONFIGURED });
  }
  const cfg = durableConfigFromEnv(process.env);
  try {
    const client = await temporalClient(cfg);
    const raws: RawScheduleDescription[] = [];
    for await (const s of client.schedule.list()) {
      // ScheduleSummary carries spec + info; fall back gracefully on partial summaries.
      const spec = (s as { spec?: { cronExpressions?: string[] } }).spec;
      const info = (
        s as { info?: { recentActions?: { takenAt?: Date }[]; nextActionTimes?: Date[] } }
      ).info;
      const action = (s as { action?: { workflowType?: string } }).action;
      if (!ownsSchedule(s.scheduleId, orgId, 'agent')) continue;
      raws.push({
        scheduleId: s.scheduleId,
        paused: (s as { state?: { paused?: boolean } }).state?.paused,
        note: (s as { state?: { note?: string } }).state?.note,
        cronExpressions: spec?.cronExpressions,
        workflowType: action?.workflowType,
        recentActions: info?.recentActions?.map((a) => a.takenAt).filter(Boolean) as
          Date[] | undefined,
        nextActions: info?.nextActionTimes,
      });
    }
    return buildSchedulesView(raws, { configured: true, reachable: true });
  } catch (e) {
    return buildSchedulesView([], {
      configured: true,
      reachable: false,
      note: `Temporal unreachable: ${(e as Error).message}`,
    });
  }
}

export interface ScheduleMutationResult {
  ok: boolean;
  scheduleId?: string;
  error?: string;
}

/** Create a Temporal Schedule that fires AgentRunWorkflow on the given cron spec. */
export async function createSchedule(spec: ScheduleSpec): Promise<ScheduleMutationResult> {
  if (!durableEnabled(process.env)) return { ok: false, error: NOT_CONFIGURED };
  const cfg = durableConfigFromEnv(process.env);
  try {
    const client = await temporalClient(cfg);
    // Each fire runs the same AgentRunWorkflow; Temporal appends the scheduled time to the workflow
    // id, so a stable base id per schedule yields a distinct execution per fire. The workflow input
    // carries a per-schedule runId seed (the pipeline persists its own concrete run id downstream).
    await client.schedule.create({
      scheduleId: spec.scheduleId,
      spec: { cronExpressions: [spec.cron] },
      action: {
        type: 'startWorkflow',
        workflowType: 'AgentRunWorkflow',
        taskQueue: cfg.taskQueue,
        args: [
          { ...spec.input, runId: scheduleRunIdSeed(spec.scheduleId), scheduled: true },
          cfg.maxAttempts,
        ],
      },
      state: {
        paused: spec.paused,
        note: spec.note,
      },
    });
    return { ok: true, scheduleId: spec.scheduleId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Pause or resume a schedule. */
export async function setSchedulePaused(
  scheduleId: string,
  paused: boolean,
  orgId: string,
): Promise<ScheduleMutationResult> {
  if (!ownsSchedule(scheduleId, orgId, 'agent')) return { ok: false, error: 'schedule not found' };
  if (!durableEnabled(process.env)) return { ok: false, error: NOT_CONFIGURED };
  const cfg = durableConfigFromEnv(process.env);
  try {
    const client = await temporalClient(cfg);
    const handle = client.schedule.getHandle(scheduleId);
    if (paused) await handle.pause();
    else await handle.unpause();
    return { ok: true, scheduleId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Delete a schedule. */
export async function deleteSchedule(
  scheduleId: string,
  orgId: string,
): Promise<ScheduleMutationResult> {
  if (!ownsSchedule(scheduleId, orgId, 'agent')) return { ok: false, error: 'schedule not found' };
  if (!durableEnabled(process.env)) return { ok: false, error: NOT_CONFIGURED };
  const cfg = durableConfigFromEnv(process.env);
  try {
    const client = await temporalClient(cfg);
    await client.schedule.getHandle(scheduleId).delete();
    return { ok: true, scheduleId };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
