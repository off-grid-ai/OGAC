import { NextResponse } from 'next/server';
import { deleteAbacRule } from '@/lib/store';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteAbacRule(id);
  return NextResponse.json({ deleted: true });
}
