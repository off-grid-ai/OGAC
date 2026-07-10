import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { listFiles, publicUrlFor, saveFile } from '@/lib/files';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const urlFor = publicUrlFor;

// POST /api/v1/files — upload. Accepts either multipart/form-data (field "file") or a
// raw body with X-Filename / Content-Type headers. Visibility via ?visibility=public|private
// (default private). Returns { id, url, ... }.
// eslint-disable-next-line complexity
export async function POST(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const owner = gate.user.email ?? 'unknown';

  const url = new URL(req.url);
  const visibility = (url.searchParams.get('visibility') || req.headers.get('x-visibility') || 'private').toLowerCase();

  let name = 'file';
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

  // TENANCY: key the upload under the caller's org so it's isolated to that tenant's Storage view.
  const orgId = await currentOrgId();
  const meta = await saveFile({ name, mime, bytes, visibility, owner, orgId });
  return NextResponse.json({ ...meta, url: urlFor(meta.id) }, { status: 201 });
}

// GET /api/v1/files — list the caller's TENANT's files. Org-scoped so org_bharat sees only bank
// files and org_suraksha only insurer files — never each other's, nor global desktop-app junk.
export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  const files = (await listFiles(gate.user.email ?? 'unknown', { orgId })).map((f) => ({ ...f, url: urlFor(f.id) }));
  return NextResponse.json({ files });
}
