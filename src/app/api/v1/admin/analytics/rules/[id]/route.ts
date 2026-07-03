import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteRule, updateRule, validateRule } from '@/lib/analytics-rules';

export const dynamic = 'force-dynamic';

// PATCH (admin) → update a rule. DELETE (admin) → remove a rule.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const v = validateRule(raw);
  if (!v.valid || !v.value) return NextResponse.json({ error: v.errors.join('; ') }, { status: 400 });
  const updated = await updateRule(id, v.value);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteRule(id);
  return NextResponse.json({ ok: true });
}
