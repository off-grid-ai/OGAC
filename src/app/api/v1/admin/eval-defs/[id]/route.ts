import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteEvalDef, updateEvalDef } from '@/lib/eval-defs';
import { validateEvalDef } from '@/lib/eval-defs-policy';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const v = validateEvalDef(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const updated = await updateEvalDef(id, v.value);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteEvalDef(id);
  return NextResponse.json({ deleted: true });
}
