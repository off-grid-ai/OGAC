import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteDocument, readDocument } from '@/lib/org-knowledge';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Read a document and its indexed chunks. Any signed-in member of the org may read (the tenancy check
// is inside readDocument, via the document's collection) — reviewing the source behind a citation is
// not an admin action.
export async function GET(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { docId } = await params;
  const document = await readDocument(docId, await currentOrgId());
  if (!document) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ document });
}

// Remove an indexed document (and its chunks) from the org knowledge base. Admin-only.
export async function DELETE(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { docId } = await params;
  await deleteDocument(docId, await currentOrgId());
  return NextResponse.json({ ok: true });
}
