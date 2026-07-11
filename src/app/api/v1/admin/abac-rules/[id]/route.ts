import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { deleteAbacRule } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  // Tenant-scoped: only the caller's org rule is deleted (cross-tenant delete-by-id).
  const org = await currentOrgId();
  await deleteAbacRule(id, org);
  auditFromSession(gate, org, {
    action: 'abac.change',
    resource: `abac:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
