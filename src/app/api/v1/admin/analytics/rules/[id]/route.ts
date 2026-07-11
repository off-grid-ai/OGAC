import { NextResponse } from 'next/server';
import { deleteRule, updateRule, validateRule } from '@/lib/analytics-rules';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// PATCH (admin) → update a rule. DELETE (admin) → remove a rule. Both org-scoped: another tenant's
// rule matches no row → 404 (no cross-tenant edit/delete via a guessed id).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const v = validateRule(raw);
  if (!v.valid || !v.value) return NextResponse.json({ error: v.errors.join('; ') }, { status: 400 });
  const updated = await updateRule(id, v.value, await currentOrgId());
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteRule(id, await currentOrgId());
  return NextResponse.json({ ok: true });
}
