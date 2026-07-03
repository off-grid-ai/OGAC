import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteGoldenCase, updateGoldenCase } from '@/lib/evals';
import { validateGoldenCase } from '@/lib/evals-golden';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const v = validateGoldenCase(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const updated = await updateGoldenCase(id, v.value);
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteGoldenCase(id);
  return NextResponse.json({ deleted: true });
}
