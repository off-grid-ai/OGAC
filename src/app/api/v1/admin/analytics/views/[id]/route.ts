import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteView, updateView, validateView } from '@/lib/analytics-rules';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// PATCH (admin) → update a saved view. DELETE (admin) → remove one. Both org-scoped: another tenant's
// view matches no row → 404 (no cross-tenant edit/delete via a guessed id).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const v = validateView(raw);
  if (!v.valid || !v.value) return NextResponse.json({ error: v.errors.join('; ') }, { status: 400 });
  const updated = await updateView(id, v.value, await currentOrgId());
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteView(id, await currentOrgId());
  return NextResponse.json({ ok: true });
}
