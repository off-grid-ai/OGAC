import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import {
  AppValidationError,
  deleteApp,
  getApp,
  publishApp,
  updateApp,
  type AppPatch,
} from '@/lib/apps-store';

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
      const published = await publishApp(id, orgId);
      if (!published) return NextResponse.json({ error: 'not found' }, { status: 404 });
      auditFromSession(gate, orgId, {
        action: 'app.publish',
        resource: `app:${id}`,
        outcome: 'ok',
      });
      return NextResponse.json(published);
    }

    // A plain field patch. Strip the publish flag; pass the rest through as an AppPatch.
    const { publish: _publish, ...patch } = body;
    const updated = await updateApp(id, orgId, patch);
    if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
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
    throw err;
  }
}

// DELETE /api/v1/admin/apps/[id] → remove the app (idempotent; 204 whether or not it existed).
export async function DELETE(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  await deleteApp(id, orgId);
  auditFromSession(gate, orgId, {
    action: 'app.delete',
    resource: `app:${id}`,
    outcome: 'ok',
  });
  return new NextResponse(null, { status: 204 });
}
