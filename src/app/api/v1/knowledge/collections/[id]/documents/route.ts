import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { publicUrlFor, saveFile } from '@/lib/files';
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

  // Two intake shapes:
  //  • multipart/form-data: the ORIGINAL file (field "file") + optional client-extracted
  //    "content" text. The raw file is stored in SeaweedFS (the file-storage layer) so the
  //    user can view exactly what they uploaded; its gateway URL is kept on the doc.
  //  • application/json: { name, content } — raw pasted text, no source file.
  let name = 'document.txt';
  let content = '';
  let file: { url: string; mime: string } | undefined;

  const ct = req.headers.get('content-type') || '';
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const f = form.get('file');
    const formContent = form.get('content');
    if (f instanceof File) {
      const bytes = Buffer.from(await f.arrayBuffer());
      const mime = f.type || 'application/octet-stream';
      name = f.name || name;
      // Client may pre-extract text (PDF/docx); for text/* fall back to the raw bytes.
      content = typeof formContent === 'string' && formContent.trim()
        ? formContent
        : mime.startsWith('text/') ? bytes.toString('utf8') : '';
      const saved = await saveFile({ name, mime, bytes, visibility: 'public', owner: session.user.email });
      file = { url: publicUrlFor(saved.id), mime };
    } else if (typeof formContent === 'string') {
      content = formContent;
      name = (form.get('name') as string) || name;
    }
  } else {
    const body = await req.json().catch(() => ({}));
    name = body.name ?? name;
    content = body.content ?? '';
  }

  if (!String(content).trim())
    return NextResponse.json({ error: 'empty document' }, { status: 400 });
  try {
    return NextResponse.json(await addDocument(id, String(name), String(content), file));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
