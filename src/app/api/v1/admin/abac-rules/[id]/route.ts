import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { deleteAbacRule } from '@/lib/store';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteAbacRule(id);
  auditFromSession(gate, await currentOrgId(), {
    action: 'abac.change',
    resource: `abac:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
