import { NextResponse } from 'next/server';
import { deleteGoldenCase } from '@/lib/evals';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteGoldenCase(id);
  return NextResponse.json({ deleted: true });
}
