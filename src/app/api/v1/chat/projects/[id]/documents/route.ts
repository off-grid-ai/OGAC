import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { projectAccess } from '@/lib/chat';
import { extractDocumentText, isRefusal } from '@/lib/document-text';
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

// Add a document to a project's knowledgebase: read the text → chunk → embed (via gateway) → store.
//
// Two intake shapes, matching the org-collection route:
//   • multipart/form-data with `file` — the file's TEXT is extracted server-side. A PDF goes through
//     pdfjs; a format we cannot read is refused with a reason naming it, rather than indexed as noise
//     (`await file.text()` on a PDF used to store the container bytes and report a healthy chunk count).
//   • application/json { name, content } — text pasted in the panel.
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

  let name = 'document.txt';
  let content = '';
  let pages: number | undefined;

  if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'no file in the request' }, { status: 400 });
    }
    name = file.name || name;
    const extracted = await extractDocumentText(
      name,
      file.type || '',
      new Uint8Array(await file.arrayBuffer()),
    ).catch((e) => ({ refused: true as const, reason: `Could not read ${name}: ${(e as Error).message}` }));
    // A refusal is a 415 with the reason — the client shows the sentence, not "upload failed".
    if (isRefusal(extracted)) {
      return NextResponse.json({ error: 'unsupported', reason: extracted.reason }, { status: 415 });
    }
    content = extracted.text;
    pages = extracted.pages;
  } else {
    const body = await req.json().catch(() => ({}));
    name = body.name ?? name;
    content = body.content ?? '';
  }

  if (!String(content).trim()) return NextResponse.json({ error: 'empty document' }, { status: 400 });
  try {
    const res = await addDocument(userId, id, String(name), String(content));
    return NextResponse.json({ ...res, pages });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
