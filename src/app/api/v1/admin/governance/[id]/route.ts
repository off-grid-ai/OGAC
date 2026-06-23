import { NextResponse } from 'next/server';
import { deleteGovernance } from '@/lib/store';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteGovernance(id);
  return NextResponse.json({ ok: true });
}
