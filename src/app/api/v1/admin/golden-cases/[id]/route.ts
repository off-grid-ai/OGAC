import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteGoldenCase } from '@/lib/evals';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteGoldenCase(id);
  return NextResponse.json({ deleted: true });
}
