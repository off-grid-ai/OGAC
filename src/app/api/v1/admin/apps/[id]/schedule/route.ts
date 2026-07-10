import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { AppValidationError, getApp, updateApp } from '@/lib/apps-store';
import {
  buildScheduleView,
  normalizeScheduleConfig,
  type ScheduleConfig,
} from '@/lib/app-schedule';
import { scheduleRuntimeConfigured, syncAppSchedule } from '@/lib/app-schedules';

export const dynamic = 'force-dynamic';

// ─── App SCHEDULE route (Builder Gap #1) — the cron/timezone/enable config surface (full CRUD) ─────
// GET    → the app's schedule config + validity + next-fire preview + whether the runner is armed.
// PATCH  → set cron/timezone/enabled (writes trigger:{kind:'schedule',config}), re-registers on the
//          durable runner, and returns the fresh view (with the next fire times the operator will see).
// DELETE → clear the schedule (revert the trigger to on-demand + tear the cron down).
// SOLID: thin handler — auth, org, load the app (404); the pure app-schedule authority normalizes +
// validates + previews; app-schedules.ts does the durable-runner I/O. No cron logic lives here.

type Ctx = { params: Promise<{ id: string }> };

function currentConfig(trigger: { kind: string; config?: Record<string, unknown> }): ScheduleConfig {
  return normalizeScheduleConfig(trigger.kind === 'schedule' ? trigger.config : undefined);
}

export async function GET(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const app = await getApp(id, await currentOrgId());
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const view = buildScheduleView(id, currentConfig(app.trigger), scheduleRuntimeConfigured());
  return NextResponse.json(view);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // Merge the patch over the app's existing schedule config so a partial patch (e.g. just `enabled`)
  // keeps the other fields — then let the pure normalizer clamp the untrusted result to a safe shape.
  const existing = currentConfig(app.trigger);
  const merged = normalizeScheduleConfig({ ...existing, ...body });

  try {
    // Persist the schedule under the schedule trigger. Setting a schedule makes the app schedule-
    // triggered (the whole point of the tab); the config carries cron/timezone/enabled.
    const updated = await updateApp(id, orgId, {
      trigger: { kind: 'schedule', config: { cron: merged.cron, timezone: merged.timezone, enabled: merged.enabled } },
    });
    if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // Reconcile with the durable runner (register/replace for a published app; paused when disabled).
    // Graceful: a runner outage / not-configured never fails the save — the view reports it honestly.
    const sync = await syncAppSchedule(updated, { caller: 'app.schedule.update' });

    const view = buildScheduleView(id, merged, scheduleRuntimeConfigured());
    auditFromSession(gate, orgId, {
      action: 'app.schedule.update',
      resource: `app:${id} cron:${merged.cron || '∅'} tz:${merged.timezone} enabled:${merged.enabled}`,
      outcome: sync.ok || sync.reason === 'not_configured' ? 'ok' : 'error',
    });
    return NextResponse.json({ ...view, sync });
  } catch (err) {
    if (err instanceof AppValidationError) {
      return NextResponse.json({ error: err.message, errors: err.errors }, { status: 422 });
    }
    throw err;
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Clearing the schedule reverts the app to on-demand; syncAppSchedule then tears the cron down.
  const updated = await updateApp(id, orgId, { trigger: { kind: 'on-demand' } });
  if (updated) await syncAppSchedule(updated, { caller: 'app.schedule.delete' });
  auditFromSession(gate, orgId, { action: 'app.schedule.delete', resource: `app:${id}`, outcome: 'ok' });
  return NextResponse.json({ object: 'app_schedule', appId: id, deleted: true });
}
