import { NextResponse } from 'next/server';
import { deleteCustomRole } from '@/lib/store';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteCustomRole(id);
  return NextResponse.json({ ok: true });
}
