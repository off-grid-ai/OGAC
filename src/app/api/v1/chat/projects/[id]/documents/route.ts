import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { projectAccess } from '@/lib/chat';
import { addDocument, listDocuments } from '@/lib/rag';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  // Access control: only members/owner/admin may read a project's documents.
  if (!(await projectAccess(userId, id, session.user.role ?? 'viewer')))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ documents: await listDocuments(id) });
}

// Add a document to a project's knowledgebase: chunk → embed (via gateway) → store.
// eslint-disable-next-line complexity
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  // Writing to a project's KB requires owner/edit access (or admin).
  const access = await projectAccess(userId, id, session.user.role ?? 'viewer');
  if (access !== 'owner' && access !== 'edit')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { name = 'document.txt', content = '' } = await req.json().catch(() => ({}));
  if (!String(content).trim()) return NextResponse.json({ error: 'empty document' }, { status: 400 });
  try {
    const res = await addDocument(userId, id, String(name), String(content));
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
