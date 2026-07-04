import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteSuppression } from '@/lib/siem-suppress';
import { currentOrgId } from '@/lib/tenancy';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const ok = await deleteSuppression(id, await currentOrgId());
  if (!ok) return NextResponse.json({ error: 'unknown suppression' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
