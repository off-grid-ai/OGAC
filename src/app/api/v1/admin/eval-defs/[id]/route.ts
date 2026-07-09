import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteEvalDef, getEvalDef, updateEvalDef } from '@/lib/eval-defs';
import { validateEvalDef } from '@/lib/eval-defs-policy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const v = validateEvalDef(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  // Org-scoped: another tenant's eval matches no row → 404 (no cross-tenant edit).
  const updated = await updateEvalDef(id, v.value, await currentOrgId());
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  // 404 if it isn't the caller's (or doesn't exist) so a guessed cross-tenant id can't be deleted.
  const existing = await getEvalDef(id, orgId);
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await deleteEvalDef(id, orgId);
  return NextResponse.json({ deleted: true });
}
