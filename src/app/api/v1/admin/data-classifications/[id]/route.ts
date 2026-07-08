import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { deleteClassification } from '@/lib/data-catalog-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Delete one classification row by its own id (org-scoped). Used to drop a per-column classification.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  const ok = await deleteClassification(id, org);
  if (!ok) return NextResponse.json({ error: 'unknown classification' }, { status: 404 });
  auditFromSession(gate, org, {
    action: 'data-classification.delete',
    resource: `data-classification:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true });
}
