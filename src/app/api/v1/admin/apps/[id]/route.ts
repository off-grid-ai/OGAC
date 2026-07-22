import { NextResponse } from 'next/server';
import { syncAppSchedule, unscheduleApp } from '@/lib/app-schedules';
import {
  APP_CAPABILITY_SELECTION_ERROR,
  extractAppCapabilitySelections,
} from '@/lib/app-capability-selection';
import {
  AppAgentOwnershipError,
  AppValidationError,
  deleteApp,
  getApp,
  publishApp,
  updateApp,
  type AppPatch,
} from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { hasActionOutcomesForApp } from '@/lib/action-outcome-observation-store';
import { requireAdmin } from '@/lib/authz';
import { validateEnterpriseAppSelections } from '@/lib/enterprise-context';
import { currentOrgId } from '@/lib/tenancy';
import { hasSolutionDeploymentsForApp } from '@/lib/solution-blueprints-store';

export const dynamic = 'force-dynamic';

// ─── Single-app routes (Builder Epic Phase 3A, task #108) ─────────────────────────────────────────
// GET / PATCH / DELETE for one app, plus a publish action (PATCH { publish:true }). Admin-gated,
// org-scoped, thin — all validation is in apps-store (validateAppSpec on every write).

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/admin/apps/[id] → the full AppSpec, or 404 if it isn't in the caller's org.
export async function GET(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const app = await getApp(id, await currentOrgId());
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(app);
}

// PATCH /api/v1/admin/apps/[id] → patch any subset of the mutable AppSpec fields, re-validated.
// Special case: { publish: true } mints a slug + flips published (the builder's "Publish" action).
export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const body = (await req.json().catch(() => null)) as (AppPatch & { publish?: boolean }) | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'a JSON patch body is required' }, { status: 400 });
  }

  try {
    if (body.publish) {
      const existing = await getApp(id, orgId);
      if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const selection = await validateEnterpriseAppSelections(
        {
          orgId,
          actor: {
            userId: gate.user.email ?? 'service@offgrid.local',
            role: gate.user.role,
          },
          appId: id,
        },
        existing,
      );
      if (!selection.ok) {
        return NextResponse.json(
          { error: APP_CAPABILITY_SELECTION_ERROR, errors: selection.errors },
          { status: 422 },
        );
      }
      const published = await publishApp(id, orgId);
      // The tenant-scoped row was resolved immediately before validation. A concurrent deletion is
      // still reported with the route's established not-found response.
      if (!published) return NextResponse.json({ error: 'not found' }, { status: 404 });
      // Wire the schedule trigger: a published schedule-trigger app registers its cron on Temporal;
      // anything else tears any prior schedule down. Graceful — a Temporal outage never fails publish.
      const sched = await syncAppSchedule(published, { caller: 'app.publish' });
      auditFromSession(gate, orgId, {
        action: 'app.publish',
        resource: `app:${id}`,
        outcome: sched.ok || sched.reason === 'not_configured' ? 'ok' : 'error',
      });
      return NextResponse.json(published);
    }

    // A plain field patch. Strip the publish flag; pass the rest through as an AppPatch.
    const { publish: _publish, ...patch } = body;
    if (extractAppCapabilitySelections(patch).length > 0 && !(await getApp(id, orgId))) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const selection = await validateEnterpriseAppSelections(
      {
        orgId,
        actor: {
          userId: gate.user.email ?? 'service@offgrid.local',
          role: gate.user.role,
        },
        appId: id,
      },
      patch,
    );
    if (!selection.ok) {
      return NextResponse.json(
        {
          error: APP_CAPABILITY_SELECTION_ERROR,
          errors: selection.errors,
        },
        { status: 422 },
      );
    }
    const updated = await updateApp(id, orgId, patch);
    if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
    // Reconcile the schedule after every update so editing the cron / trigger / published flag takes
    // effect immediately (published+schedule+cron → register/replace; otherwise → tear down).
    await syncAppSchedule(updated, { caller: 'app.update' });
    auditFromSession(gate, orgId, {
      action: 'app.update',
      resource: `app:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof AppValidationError) {
      return NextResponse.json({ error: err.message, errors: err.errors }, { status: 422 });
    }
    if (err instanceof AppAgentOwnershipError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

// DELETE /api/v1/admin/apps/[id] → remove the app (idempotent; 204 whether or not it existed).
export async function DELETE(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  if (await hasActionOutcomesForApp(id, orgId)) {
    return NextResponse.json(
      {
        error: 'This App has retained business-result evidence and cannot be deleted',
        code: 'referenced',
        action: 'keep the App so its audit history remains available',
      },
      { status: 409 },
    );
  }
  if (await hasSolutionDeploymentsForApp(id, orgId)) {
    return NextResponse.json(
      {
        error: 'App is retained by solution deployment history',
        code: 'referenced',
        action: 'retire the deployment instead',
      },
      { status: 409 },
    );
  }
  await deleteApp(id, orgId);
  // Tear down any registered cron schedule for this app (idempotent; a missing schedule is fine).
  await unscheduleApp(id, orgId);
  auditFromSession(gate, orgId, {
    action: 'app.delete',
    resource: `app:${id}`,
    outcome: 'ok',
  });
  return new NextResponse(null, { status: 204 });
}
