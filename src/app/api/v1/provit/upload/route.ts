import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { currentPrincipal, provitAbacAllows } from '@/lib/provit-access';
import { deleteFile, getFileMeta, listFiles, publicUrlFor, saveFile } from '@/lib/files';
import { displayName, isProvitUploadName, provitUploadName } from '@/lib/provit-upload';

export const dynamic = 'force-dynamic';

// Provit FILE UPLOAD — console-brokered, honest.
//
// Provit's deployed HTTP intake maps a repo from a *public URL* (evidence: provit/src/ui/server.ts
// POST /api/ingest + tryDemo.ts fetch a tarball/zip from a URL — there is NO raw multipart upload
// endpoint on Provit). So we do NOT invent one. Instead we reuse the console's storage (SeaweedFS
// via src/lib/files.ts) as the ONE store: an operator uploads a file (e.g. a repo zip) here, it
// lands PUBLIC in the shared media bucket tagged as a Provit upload, and we return the public URL
// Provit can fetch. No parallel store, no schema table — the bucket is the source of truth. The
// tag convention (which stored files are Provit uploads) is the pure, tested rule in
// src/lib/provit-upload.ts. Thin handler; storage + broker patterns reused wholesale.

const MAX_BYTES = Number(process.env.OFFGRID_PROVIT_UPLOAD_MAX_BYTES || 200 * 1024 * 1024);

// GET — list Provit uploads (the shared bucket, filtered to the Provit-tagged files).
export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const p = await currentPrincipal();
  if (!(await provitAbacAllows(p, 'read'))) return NextResponse.json({ uploads: [] });
  const all = await listFiles(p.email);
  const uploads = all
    .filter((f) => isProvitUploadName(f.name))
    .map((f) => ({ id: f.id, name: displayName(f.name), mime: f.mime, size: f.size, createdAt: f.createdAt, url: publicUrlFor(f.id) }));
  return NextResponse.json({ uploads }, { headers: { 'cache-control': 'no-store' } });
}

// POST — upload a file for Provit. multipart/form-data (field "file") or a raw body with
// X-Filename. Stored PUBLIC (so Provit can fetch it by URL), tagged as a Provit upload.
// eslint-disable-next-line complexity
export async function POST(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const p = await currentPrincipal();
  if (!(await provitAbacAllows(p, 'write'))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const owner = p.email || 'unknown';

  let name = 'upload';
  let mime = 'application/octet-stream';
  let bytes: Buffer;
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const f = form.get('file');
    if (!(f instanceof File)) return NextResponse.json({ error: 'no file field' }, { status: 400 });
    name = f.name || name;
    mime = f.type || mime;
    bytes = Buffer.from(await f.arrayBuffer());
  } else {
    bytes = Buffer.from(await req.arrayBuffer());
    if (!bytes.length) return NextResponse.json({ error: 'empty body' }, { status: 400 });
    name = req.headers.get('x-filename') || name;
    mime = ct || mime;
  }
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: `file exceeds the ${Math.round(MAX_BYTES / 1024 / 1024)} MB limit` }, { status: 413 });
  }

  const meta = await saveFile({ name: provitUploadName(name), mime, bytes, visibility: 'public', owner });
  return NextResponse.json({ id: meta.id, name: displayName(meta.name), mime: meta.mime, size: meta.size, createdAt: meta.createdAt, url: publicUrlFor(meta.id) }, { status: 201 });
}

// DELETE ?id=… — remove a Provit upload from SeaweedFS. Owner or admin only. Guarded to the
// Provit-tagged files so this route can't be used to delete arbitrary console storage.
export async function DELETE(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const p = await currentPrincipal();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const meta = await getFileMeta(id);
  if (!meta || !isProvitUploadName(meta.name)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const ok = await deleteFile(id, p.email || '', p.role === 'admin');
  return ok ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
