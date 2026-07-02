import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { listFiles, saveFile } from '@/lib/files';

export const dynamic = 'force-dynamic';

// Public base for the returned URL. Defaults to the on-prem console hostname.
const PUBLIC_BASE = process.env.OFFGRID_PUBLIC_BASE || 'https://onprem-console.getoffgridai.co';

function urlFor(id: string): string {
  return `${PUBLIC_BASE}/api/v1/files/${id}`;
}

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

  const meta = await saveFile({ name, mime, bytes, visibility, owner });
  return NextResponse.json({ ...meta, url: urlFor(meta.id) }, { status: 201 });
}

// GET /api/v1/files — list the caller's files.
export async function GET(req: Request): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const files = (await listFiles(gate.user.email ?? 'unknown')).map((f) => ({ ...f, url: urlFor(f.id) }));
  return NextResponse.json({ files });
}
