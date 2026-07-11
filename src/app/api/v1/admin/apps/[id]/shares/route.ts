import { NextResponse } from 'next/server';
import { listAppGrants, grantAppAccess, revokeAppAccess } from '@/lib/app-sharing';
import { isAppShareRole, normalizeUserId } from '@/lib/app-sharing-policy';
import { getApp } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app SHARING management (Google-Doc-style grants) ─────────────────────────────────────────
// GET    → the app's explicit per-user grants.
// POST   → grant/change ONE Keycloak user's app-role (viewer/runner/approver/editor). Idempotent by user.
// DELETE → revoke ONE user's grant (?userId=…).
// Admin-gated, org-scoped, thin — the grant precedence + validation live in app-sharing-policy.ts,
// the persistence in app-sharing.ts. The app's owner + admins + the owner's management chain always
// have access without a grant (resolved in the enforcement seam).

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const grants = await listAppGrants(id, orgId);
  return NextResponse.json({ appId: id, ownerId: app.ownerId, grants });
}

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const userId = normalizeUserId(body?.userId);
  const role = body?.role;
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  if (!isAppShareRole(role)) {
    return NextResponse.json(
      { error: 'role must be one of viewer|runner|approver|editor' },
      { status: 400 },
    );
  }

  const grants = await grantAppAccess(id, orgId, app.ownerId, userId, role);
  auditFromSession(gate, orgId, {
    action: 'policy.change',
    resource: `app-share:${id}:${userId}`,
    outcome: 'ok',
  });
  return NextResponse.json({ appId: id, ownerId: app.ownerId, grants });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const userId = normalizeUserId(new URL(req.url).searchParams.get('userId'));
  if (!userId) return NextResponse.json({ error: 'userId query param is required' }, { status: 400 });

  const grants = await revokeAppAccess(id, orgId, app.ownerId, userId);
  auditFromSession(gate, orgId, {
    action: 'policy.change',
    resource: `app-share:${id}:${userId}`,
    outcome: 'ok',
  });
  return NextResponse.json({ appId: id, ownerId: app.ownerId, grants });
}
