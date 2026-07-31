import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractDocumentText, isRefusal } from '@/lib/document-text';
import { publicUrlFor, saveFile } from '@/lib/files';
import { addDocument, getCollection, listDocuments } from '@/lib/org-knowledge';
import { currentOrgId } from '@/lib/tenancy';

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
  const orgId = await currentOrgId();
  const col = await getCollection(id, orgId);
  if (!col) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!mayAccess(session.user.role ?? 'viewer', col.allowedRoles))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ documents: await listDocuments(id, orgId) });
}

// Index a document into the collection: chunk → embed (gateway) → store. Admin-only (curated).
// eslint-disable-next-line complexity
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  const orgId = await currentOrgId();
  const col = await getCollection(id, orgId);
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
      // Extract the text SERVER-SIDE (pdfjs for PDFs), so a PDF no longer indexes its container bytes
      // as if they were prose. A client-supplied `content` still wins — the browser may have extracted
      // a format we cannot read here — but the fallback is real extraction, not raw bytes.
      if (typeof formContent === 'string' && formContent.trim()) {
        content = formContent;
      } else {
        const extracted = await extractDocumentText(name, mime, new Uint8Array(bytes)).catch((e) => ({
          refused: true as const,
          reason: `Could not read ${name}: ${(e as Error).message}`,
        }));
        if (isRefusal(extracted)) {
          return NextResponse.json({ error: 'unsupported', reason: extracted.reason }, { status: 415 });
        }
        content = extracted.text;
      }
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
    return NextResponse.json(await addDocument(id, String(name), String(content), file, orgId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
