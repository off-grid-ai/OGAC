import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getApp } from '@/lib/apps-store';
import { validateAppAccessPolicyInput } from '@/lib/app-access-policy';
import {
  deleteAppAccessPolicy,
  resolveAppAccessPolicy,
  setAppAccessPolicy,
} from '@/lib/app-access';

export const dynamic = 'force-dynamic';

// ─── Per-app ACCESS POLICY management (Consumers governance) ──────────────────────────────────────
// GET  → the effective access policy for an app (stored, or the least-privilege default).
// PUT  → set/replace the app's access policy (validated by the pure module).
// DELETE → clear the bound policy (reverts to owner + admins only).
// Admin-gated, org-scoped, thin — the decision + validation live in app-access-policy.ts, the
// persistence in app-access.ts.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const policy = await resolveAppAccessPolicy(id, orgId, app.ownerId);
  return NextResponse.json(policy);
}

export async function PUT(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const result = validateAppAccessPolicyInput(body);
  if (!result.ok || !result.value) {
    return NextResponse.json({ error: result.errors.join('; '), errors: result.errors }, { status: 400 });
  }
  const saved = await setAppAccessPolicy(id, orgId, app.ownerId, result.value);
  auditFromSession(gate, orgId, {
    action: 'policy.change',
    resource: `app-access:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(saved);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const removed = await deleteAppAccessPolicy(id, orgId);
  auditFromSession(gate, orgId, {
    action: 'policy.change',
    resource: `app-access:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, cleared: removed });
}
