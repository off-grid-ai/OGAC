import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { deleteCustomRole } from '@/lib/store';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  // Tenant-scoped: only the caller's org role is deleted (cross-tenant delete-by-id — P0).
  const org = await currentOrgId();
  await deleteCustomRole(id, org);
  auditFromSession(gate, org, {
    action: 'access.role.change',
    resource: `role:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true });
}
