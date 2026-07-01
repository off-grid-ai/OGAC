import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteDocument } from '@/lib/org-knowledge';

export const dynamic = 'force-dynamic';

// Remove an indexed document (and its chunks) from the org knowledge base. Admin-only.
export async function DELETE(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { docId } = await params;
  await deleteDocument(docId);
  return NextResponse.json({ ok: true });
}
