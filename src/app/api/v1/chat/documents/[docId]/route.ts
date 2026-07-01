import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteDocument } from '@/lib/rag';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { docId } = await params;
  await deleteDocument(docId);
  return NextResponse.json({ ok: true });
}
