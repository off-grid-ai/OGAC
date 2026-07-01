import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { addDocument, getCollection, listDocuments } from '@/lib/org-knowledge';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// A role may access a collection when unrestricted or explicitly listed; admins always may.
function mayAccess(role: string, allowedRoles: string[] | null | undefined): boolean {
  return role === 'admin' || !allowedRoles?.length || allowedRoles.includes(role);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const col = await getCollection(id);
  if (!col) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!mayAccess(session.user.role ?? 'viewer', col.allowedRoles))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ documents: await listDocuments(id) });
}

// Index a document into the collection: chunk → embed (gateway) → store. Admin-only (curated).
// eslint-disable-next-line complexity
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  const col = await getCollection(id);
  if (!col) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { name = 'document.txt', content = '' } = await req.json().catch(() => ({}));
  if (!String(content).trim())
    return NextResponse.json({ error: 'empty document' }, { status: 400 });
  try {
    return NextResponse.json(await addDocument(id, String(name), String(content)));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
