import { NextResponse } from 'next/server';
import { deleteConnector } from '@/lib/store';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteConnector(id);
  return NextResponse.json({ deleted: true });
}
