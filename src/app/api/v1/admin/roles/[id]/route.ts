import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { deleteCustomRole } from '@/lib/store';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  await deleteCustomRole(id);
  return NextResponse.json({ ok: true });
}
