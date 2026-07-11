import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { isRbacRole } from '@/lib/roles';
import { setUserRole } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

// Change a user's RBAC role.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!isRbacRole(body?.role)) {
    return NextResponse.json(
      { error: 'role must be admin, compliance, or viewer' },
      { status: 400 },
    );
  }
  // Tenant-scoped: the target user must be in the caller's org (cross-tenant privilege change — P0).
  const org = await currentOrgId();
  const updated = await setUserRole(id, body.role, org);
  if (!updated) {
    return NextResponse.json({ error: 'unknown user' }, { status: 404 });
  }
  auditFromSession(gate, org, {
    action: 'access.user.change',
    resource: `user:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}
