// ─── App schedules (Builder Epic #103, Phase 2B) — a cron trigger that fires an APP-RUN ───────────
//
// Generalizes the schedule path from "cron fires a single AgentRunWorkflow" to "cron fires the
// multi-step AppRunWorkflow". This is the I/O bridge over @temporalio/client's ScheduleClient; it
// WRAPS temporal-schedules.ts — it REUSES isValidCron + the id-sanitization rule from there rather
// than re-implementing cron validation (single source of truth). It does NOT edit temporal-schedules.
//
// SOLID: cron/id validity is pure (reused from temporal-schedules.ts); this file is only the I/O.
// Every op is GRACEFUL — never throws; not_configured when durable is off, error string on failure —
// so the console degrades cleanly when Temporal is unreachable.
//
// A scheduled fire runs AppRunWorkflow with a per-schedule base runId (Temporal appends the nominal
// fire time so each execution is distinct + idempotent). The spec is loaded by the workflow's
// loadAppSpec activity at fire time (the schedule stores only the appId, not a spec snapshot, so
// edits to the app take effect on the next fire).

import { durableEnabled } from '@/lib/agent-run-durable';
import {
  type AppDurableConfig,
  appDurableConfigFromEnv,
  type AppRunWorkflowInput,
} from '@/lib/app-run-durable';
import { normalizeScheduleConfig, type ScheduleConfig } from '@/lib/app-schedule';
import { isValidCron, sanitizeScheduleId } from '@/lib/temporal-schedules';

function appDurableEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return durableEnabled(env) || env.OFFGRID_ADAPTER_APPRUNTIME === 'temporal';
}

/**
 * Is the durable runner configured to ACTUALLY fire schedules? Exported so the Schedule tab/API can
 * tell the operator the honest truth: a valid schedule with the runner off is SAVED but DORMANT (it
 * fires only once the durable app runtime is enabled) — never a silent "scheduled ✓" that does nothing.
 */
export function scheduleRuntimeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return appDurableEnabled(env);
}

const NOT_CONFIGURED =
  'Durable app runtime not enabled — set OFFGRID_QUEUE_ENABLED=1 or OFFGRID_ADAPTER_APPRUNTIME=temporal.';

export interface AppScheduleResult {
  ok: boolean;
  scheduleId?: string;
  reason?: 'not_configured' | 'invalid' | 'unreachable' | 'not_found';
  error?: string;
}

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

/** Derive the schedule id for an app (stable per app so re-scheduling replaces, not duplicates). */
export function appScheduleId(appId: string): string {
  return sanitizeScheduleId(`appsched-${appId}`) || `appsched-app`;
}

// ─── cronFromTrigger — PURE: the cron spec a schedule trigger carries, or null ────────────────────
// A schedule-triggered app stores its cron under trigger.config.cron (or `.schedule`/`.expression`).
// This pure reader is the single place the publish/update route asks "does this app want a cron
// schedule, and what is it?" — so the route stays a thin caller and the rule is unit-testable.
export function cronFromTrigger(
  trigger: { kind: string; config?: Record<string, unknown> } | null | undefined,
): string | null {
  if (trigger?.kind !== 'schedule') return null;
  const c = trigger.config ?? {};
  const raw = c.cron ?? c.schedule ?? c.expression;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim();
}

// ─── scheduleConfigFromTrigger — PURE: the full {cron,timezone,enabled} a trigger carries ─────────
// Where cronFromTrigger answers just "what cron?", this returns the whole normalized ScheduleConfig
// (delegating to the pure app-schedule authority) so the I/O bridge can honor the TIMEZONE + the
// enabled/paused flag — not only the cron. Returns null for a non-schedule trigger or one with no cron
// set (the "picked schedule but didn't configure it" dead-end → nothing to register).
export function scheduleConfigFromTrigger(
  trigger: { kind: string; config?: Record<string, unknown> } | null | undefined,
): ScheduleConfig | null {
  if (trigger?.kind !== 'schedule') return null;
  const cfg = normalizeScheduleConfig(trigger.config);
  return cfg.cron ? cfg : null;
}

// ─── cronWithTimezone — prefix a cron with CRON_TZ so Temporal fires it in the operator's zone ─────
// PURE. Temporal's cronExpressions accept a "CRON_TZ=<zone> <cron>" prefix. A UTC schedule needs no
// prefix (UTC is the default). Kept here (not app-schedule.ts) because it's Temporal-spec-shaped I/O
// syntax, not a general schedule rule.
export function cronWithTimezone(cron: string, timezone: string): string {
  const tz = (timezone ?? '').trim();
  if (!tz || tz.toUpperCase() === 'UTC') return cron.trim();
  return `CRON_TZ=${tz} ${cron.trim()}`;
}

// ─── syncAppSchedule — reconcile an app's cron schedule with its current spec (I/O, graceful) ─────
// The one entry point the publish/update route calls after a write, and delete calls to tear down.
// Rules:
//   • published schedule-trigger app with a cron  → scheduleApp (create/replace)
//   • otherwise (unpublished, non-schedule, or no cron) → unscheduleApp (idempotent teardown)
// NEVER throws — returns the AppScheduleResult so the route can note it in the audit trail without
// letting a Temporal outage fail the publish. A missing/not_found teardown is a benign success.
export async function syncAppSchedule(
  app: {
    id: string;
    orgId?: string;
    published?: boolean;
    trigger?: { kind: string; config?: Record<string, unknown> };
  },
  opts: { caller?: string } = {},
): Promise<AppScheduleResult> {
  const cfg = app.published ? scheduleConfigFromTrigger(app.trigger) : null;
  if (cfg) {
    // Honor the operator's timezone (CRON_TZ prefix) AND the enabled flag: a disabled schedule is
    // still REGISTERED but starts PAUSED, so it never fires until the operator re-arms it (rather than
    // silently vanishing). This makes "saved but paused" an honest, reversible state.
    return scheduleApp(app.id, cronWithTimezone(cfg.cron, cfg.timezone), {
      orgId: app.orgId,
      caller: opts.caller,
      paused: !cfg.enabled,
    });
  }
  const res = await unscheduleApp(app.id);
  // A teardown that found nothing to remove is a benign success for the caller's purposes.
  if (!res.ok && res.reason === 'not_found') return { ok: true, scheduleId: res.scheduleId };
  return res;
}

/** Base runId for a scheduled fire; Temporal appends the nominal time to keep executions distinct. */
export function appScheduleRunSeed(appId: string): string {
  return `appsched_${appId}`;
}

// ─── scheduleApp — create/replace a cron schedule that fires this app's AppRunWorkflow ────────────
export async function scheduleApp(
  appId: string,
  cron: string,
  opts: { orgId?: string; caller?: string; input?: Record<string, unknown>; note?: string; paused?: boolean } = {},
): Promise<AppScheduleResult> {
  if (!appDurableEnabled()) return { ok: false, reason: 'not_configured', error: NOT_CONFIGURED };
  if (!isValidCron(cron)) {
    return { ok: false, reason: 'invalid', error: 'valid cron spec required (5-/6-field cron or an @macro)' };
  }
  const cfg = appDurableConfigFromEnv(process.env);
  const scheduleId = appScheduleId(appId);
  const wfInput: AppRunWorkflowInput = {
    appId,
    runId: appScheduleRunSeed(appId),
    input: opts.input ?? {},
    orgId: opts.orgId,
    caller: opts.caller,
  };
  try {
    const client = await temporalClient(cfg);
    // Replace an existing schedule for this app so re-scheduling is idempotent (delete-then-create;
    // a missing prior schedule is fine).
    await client.schedule.getHandle(scheduleId).delete().catch(() => {});
    await client.schedule.create({
      scheduleId,
      spec: { cronExpressions: [cron.trim()] },
      action: {
        type: 'startWorkflow',
        workflowType: 'AppRunWorkflow',
        taskQueue: cfg.taskQueue,
        // Note: the spec is NOT snapshotted — the workflow's loadAppSpec activity fetches the current
        // AppSpec at fire time, so edits take effect on the next fire.
        args: [wfInput, cfg.maxAttempts],
      },
      state: { paused: opts.paused === true, note: opts.note },
    });
    return { ok: true, scheduleId };
  } catch (e) {
    return { ok: false, reason: 'unreachable', error: `Temporal unreachable: ${(e as Error).message}` };
  }
}

// ─── unscheduleApp — remove an app's cron schedule ────────────────────────────────────────────────
export async function unscheduleApp(appId: string): Promise<AppScheduleResult> {
  if (!appDurableEnabled()) return { ok: false, reason: 'not_configured', error: NOT_CONFIGURED };
  const cfg = appDurableConfigFromEnv(process.env);
  const scheduleId = appScheduleId(appId);
  try {
    const client = await temporalClient(cfg);
    await client.schedule.getHandle(scheduleId).delete();
    return { ok: true, scheduleId };
  } catch (e) {
    const msg = (e as Error).message ?? '';
    const notFound = /not found|no execution|WorkflowNotFound|schedule not found/i.test(msg);
    return {
      ok: false,
      scheduleId,
      reason: notFound ? 'not_found' : 'unreachable',
      error: notFound ? 'schedule not found' : `Temporal unreachable: ${msg}`,
    };
  }
}

// ─── setAppSchedulePaused — pause/resume an app's schedule ────────────────────────────────────────
export async function setAppSchedulePaused(appId: string, paused: boolean): Promise<AppScheduleResult> {
  if (!appDurableEnabled()) return { ok: false, reason: 'not_configured', error: NOT_CONFIGURED };
  const cfg = appDurableConfigFromEnv(process.env);
  const scheduleId = appScheduleId(appId);
  try {
    const client = await temporalClient(cfg);
    const handle = client.schedule.getHandle(scheduleId);
    if (paused) await handle.pause();
    else await handle.unpause();
    return { ok: true, scheduleId };
  } catch (e) {
    return { ok: false, scheduleId, reason: 'unreachable', error: `Temporal unreachable: ${(e as Error).message}` };
  }
}
