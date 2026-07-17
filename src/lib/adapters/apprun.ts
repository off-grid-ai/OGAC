// App-runtime adapter — the I/O bridge that decides HOW a multi-step app-run executes and carries
// the mid-workflow HITL resume signal (Builder Epic Phase 2B). Mirrors agentruntime.ts.
//
// TWO EXECUTION PATHS (chosen by the PURE decision shouldRunDurably in app-run-durable.ts):
//   • DURABLE (multi-step OR has a human step) → submit AppRunWorkflow to Temporal (:7233). The
//     workflow drives the step graph and PAUSES on a human step until signalAppRun releases it.
//   • INLINE (a simple single-step agent app) → runApp(...) in-process to completion.
//
// The Temporal client speaks gRPC and is bound via a DYNAMIC import so @temporalio/client never
// enters the default Next bundle (next.config aliases @temporalio/worker to false; the client is a
// serverExternalPackage, required at runtime only when durable mode is actually selected). EVERY
// exported function is GRACEFUL — it never throws; if Temporal is off/unreachable it reports the
// degraded outcome (not_configured / unreachable) and, for submit, falls back to the inline path so
// selecting durable NEVER breaks a run and the UI degrades cleanly when the fleet is down.
//
// Config (all optional; fleet defaults in app-run-durable.ts):
//   OFFGRID_QUEUE_ENABLED=1 | OFFGRID_ADAPTER_APPRUNTIME=temporal — opt into durable dispatch
//   OFFGRID_TEMPORAL_ADDRESS (host:7233), OFFGRID_TEMPORAL_NAMESPACE, OFFGRID_APP_TASK_QUEUE

import { durableEnabled } from '@/lib/agent-run-durable';
import type { AppSpec } from '@/lib/app-model';
import type { AppRunContext, AppRunOutcome } from '@/lib/app-run';
import {
  type AppDurableConfig,
  appDurableConfigFromEnv,
  appWorkflowIdFor,
  type AppRunWorkflowInput,
  type AppRunWorkflowResult,
  shouldRunDurably,
} from '@/lib/app-run-durable';

const NOT_CONFIGURED =
  'Durable app runtime not enabled — set OFFGRID_QUEUE_ENABLED=1 or OFFGRID_ADAPTER_APPRUNTIME=temporal.';

// ── Durable dispatch opt-in ──────────────────────────────────────────────────────────────────────
// Reuse the fleet-wide async toggle (OFFGRID_QUEUE_ENABLED) or an app-runtime-specific selection.
function appDurableEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return durableEnabled(env) || env.OFFGRID_ADAPTER_APPRUNTIME === 'temporal';
}

// ── Handle types ──────────────────────────────────────────────────────────────────────────────
export interface AppRunHandle {
  runId: string;
  workflowId?: string;
  mode: 'inline' | 'durable';
  submitted: boolean;
  /** Terminal/interim run status when known. */
  status?: string;
  note?: string;
  /** For the inline path: the full outcome (steps + aggregate), so the caller needn't re-read. */
  outcome?: AppRunOutcome;
}

export interface AppRunSignalResult {
  ok: boolean;
  workflowId?: string;
  reason?: 'not_found' | 'unreachable' | 'not_configured';
  error?: string;
}

export interface AppRunDescribe {
  configured: boolean;
  reachable: boolean;
  workflowId?: string;
  status?: string;
  note?: string;
}

// A cached Temporal Client keyed by address/namespace so repeated calls reuse one gRPC channel.
let cachedClient: { key: string; client: import('@temporalio/client').Client } | null = null;

async function temporalClient(cfg: AppDurableConfig): Promise<import('@temporalio/client').Client> {
  const key = `${cfg.temporalAddress}/${cfg.namespace}`;
  if (cachedClient?.key === key) return cachedClient.client;
  const { Connection, Client } = await import('@temporalio/client');
  const connection = await Connection.connect({ address: cfg.temporalAddress });
  const client = new Client({ connection, namespace: cfg.namespace });
  cachedClient = { key, client };
  return client;
}

// ── submitAppRun — durable when shouldRunDurably, else inline; graceful fallback either way ───────
/**
 * Submit an app-run. If the spec needs durability (multi-step or has a human step) AND the durable
 * runtime is enabled + reachable, start AppRunWorkflow on Temporal; otherwise run inline via runApp.
 * NEVER throws — any failure to reach Temporal falls back to the inline path so a run always
 * completes (an inline run of a spec with a human step stops at the first human pause, as designed).
 */
export async function submitAppRun(
  spec: AppSpec,
  input: Record<string, unknown>,
  ctx: AppRunContext,
): Promise<AppRunHandle> {
  // This is the ONE execution chokepoint shared by admin, public-slug, webhook, inbound-email,
  // token, IMAP, WhatsApp and app-as-tool callers. An adopted solution contract must therefore be
  // checked here, against the exact AppSpec that is about to execute, before either Temporal or the
  // inline runner can create a run or perform a step. Callers cannot opt out of this guard.
  const { assertSolutionRuntimeBinding } = await import('@/lib/solution-blueprints-store');
  await assertSolutionRuntimeBinding(spec, ctx.orgId);

  const wantDurable = shouldRunDurably(spec) && appDurableEnabled();

  if (wantDurable) {
    const handle = await trySubmitDurable(spec, input, ctx);
    if (handle) return handle;
    // Durable requested but Temporal unreachable — fall through to inline (graceful degrade).
  }

  return runInline(spec, input, ctx, wantDurable ? 'durable requested but Temporal unreachable' : undefined);
}

async function trySubmitDurable(
  spec: AppSpec,
  input: Record<string, unknown>,
  ctx: AppRunContext,
): Promise<AppRunHandle | null> {
  const cfg = appDurableConfigFromEnv(process.env);
  const workflowId = appWorkflowIdFor(spec.id, ctx.runId);
  const wfInput: AppRunWorkflowInput = {
    appId: spec.id,
    runId: ctx.runId,
    input,
    orgId: ctx.orgId,
    caller: ctx.actor,
    // PA-16 — thread the bound-pipeline id onto the durable path so the WORKER enforces the same
    // contract the inline route does. The route already resolved the contract into ctx.contract
    // (resolveConsumerPipeline → resolveContract); carry its pipelineId so the workflow re-resolves
    // the full contract via an activity (the I/O boundary). Null ⇒ no binding ⇒ legacy allow.
    pipelineId: ctx.contract?.pipelineId ?? null,
    // BFSI blast-radius — carry the resolved run mode so the WORKER intercepts side-effecting sinks
    // on a shadow run identically to the inline path. Default 'live' (additive).
    mode: ctx.mode ?? 'live',
  };
  try {
    const client = await temporalClient(cfg);
    // Idempotent start: reusing the same workflowId for a runId won't spawn a duplicate. The spec is
    // inlined as the 3rd arg so the deterministic workflow never has to load it (the load activity
    // is only a fallback). maxAttempts is the 2nd arg (matches the workflow signature).
    await client.workflow.start('AppRunWorkflow', {
      taskQueue: cfg.taskQueue,
      workflowId,
      args: [wfInput, cfg.maxAttempts, spec],
    });
    // Do NOT await the result here — a durable app-run may PAUSE on a human step for an arbitrarily
    // long time, so blocking the request would hang. Return a started handle; the console polls
    // describeAppRun / reads the app_runs row for live status.
    return {
      runId: ctx.runId,
      workflowId,
      mode: 'durable',
      submitted: true,
      status: 'running',
      note: 'workflow started; poll status (may pause at a human step)',
    };
  } catch {
    return null; // unreachable — caller falls back to inline
  }
}

async function runInline(
  spec: AppSpec,
  input: Record<string, unknown>,
  ctx: AppRunContext,
  note?: string,
): Promise<AppRunHandle> {
  const { runApp } = await import('@/lib/app-run');
  const outcome = await runApp(spec, input, ctx);
  return {
    runId: outcome.runId,
    mode: 'inline',
    submitted: false,
    status: outcome.status,
    note,
    outcome,
  };
}

// ── signalAppRun — release a paused human step (the HITL resume) ──────────────────────────────────
/**
 * Send the `resumeStep` signal to a paused app-run workflow, carrying the operator's decision
 * (approve/reject + optional edited output). Graceful: not_configured when durable is off,
 * not_found for a missing/closed workflow, unreachable when Temporal can't be reached.
 *
 * The workflowId is derived from appId+runId (the same idempotent derivation submit used), so the
 * caller only needs those two ids — no separate handle bookkeeping.
 */
export async function signalAppRun(
  appId: string,
  runId: string,
  decision: { stepId: string; decision: 'approve' | 'reject'; output?: string; note?: string },
): Promise<AppRunSignalResult> {
  if (!appDurableEnabled()) return { ok: false, reason: 'not_configured', error: NOT_CONFIGURED };
  const cfg = appDurableConfigFromEnv(process.env);
  const workflowId = appWorkflowIdFor(appId, runId);
  try {
    const client = await temporalClient(cfg);
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal('resumeStep', decision);
    return { ok: true, workflowId };
  } catch (e) {
    const msg = (e as Error).message ?? '';
    const notFound = /not found|no execution|WorkflowNotFound/i.test(msg);
    return {
      ok: false,
      workflowId,
      reason: notFound ? 'not_found' : 'unreachable',
      error: notFound ? 'workflow not found' : `Temporal unreachable: ${msg}`,
    };
  }
}

// ── describeAppRun — read a durable run's live status ─────────────────────────────────────────────
/**
 * Describe a durable app-run workflow by appId+runId. NEVER throws — returns a configured/reachable-
 * flagged view. A COMPLETED workflow's result carries the persisted run's terminal status; a running
 * one reports 'running' (it may be paused at a human step — the app_runs row / runState query carries
 * the fine-grained per-step state; this is the coarse workflow-level status).
 */
export async function describeAppRun(appId: string, runId: string): Promise<AppRunDescribe> {
  if (!appDurableEnabled()) {
    return { configured: false, reachable: false, note: NOT_CONFIGURED };
  }
  const cfg = appDurableConfigFromEnv(process.env);
  const workflowId = appWorkflowIdFor(appId, runId);
  try {
    const client = await temporalClient(cfg);
    const handle = client.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    let status = mapWorkflowStatus(desc.status?.name);
    if (desc.status?.name === 'COMPLETED') {
      const result = (await handle.result().catch(() => undefined)) as AppRunWorkflowResult | undefined;
      if (result) status = result.found ? result.status : 'not_found';
    }
    return { configured: true, reachable: true, workflowId, status };
  } catch (e) {
    const msg = (e as Error).message ?? '';
    const notFound = /not found|no execution|WorkflowNotFound/i.test(msg);
    return {
      configured: true,
      reachable: !notFound,
      workflowId,
      note: notFound ? 'workflow not found' : `Temporal unreachable: ${msg}`,
    };
  }
}

// Coarse workflow-execution-status → run-vocabulary mapping (the fine per-step state lives in the
// app_runs row). A RUNNING workflow may be paused at a human step; that nuance is in the row.
function mapWorkflowStatus(name: string | undefined): string {
  switch (name) {
    case 'RUNNING':
    case 'CONTINUED_AS_NEW':
      return 'running';
    case 'COMPLETED':
      return 'done';
    case 'CANCELED':
    case 'TERMINATED':
      return 'cancelled';
    case 'FAILED':
    case 'TIMED_OUT':
      return 'error';
    default:
      return 'queued';
  }
}

/** Health probe for the durable app runtime (mirrors agentruntime.health). */
export async function appRuntimeHealth(): Promise<boolean> {
  if (!appDurableEnabled()) return false;
  const cfg = appDurableConfigFromEnv(process.env);
  try {
    const { Connection } = await import('@temporalio/client');
    const connection = await Connection.connect({ address: cfg.temporalAddress });
    await connection.workflowService.getSystemInfo({});
    return true;
  } catch {
    return false;
  }
}
