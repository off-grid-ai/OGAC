import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { projectAccess, readProjectDocument } from '@/lib/chat';

export const dynamic = 'force-dynamic';

// Read one project document, including the chunks retrieval actually sees. Gated by project access, the
// same rule as every other project sub-resource.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id, docId } = await params;
  const access = await projectAccess(email, id, session.user.role ?? 'viewer');
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const doc = await readProjectDocument(docId, id);
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ document: doc });
}
