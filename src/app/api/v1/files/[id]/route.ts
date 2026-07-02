import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { deleteFile, getFileMeta, readFileBytes, setVisibility } from '@/lib/files';

export const dynamic = 'force-dynamic';

// GET /api/v1/files/:id — retrieve a file.
//   • public files: served to anyone (this route is whitelisted in the middleware).
//   • private files: require auth (session or Bearer key), else 404 (don't reveal existence).
//   • ?meta=1 returns JSON metadata instead of the bytes.
// eslint-disable-next-line complexity
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const meta = await getFileMeta(id);
  if (!meta) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (meta.visibility !== 'public') {
    const gate = await requireUser(req);
    if (gate instanceof NextResponse) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (gate.user.role !== 'admin' && gate.user.email !== meta.owner) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
  }

  if (new URL(req.url).searchParams.get('meta') === '1') {
    return NextResponse.json(meta);
  }

  const bytes = await readFileBytes(id);
  if (!bytes) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': meta.mime,
      'content-length': String(meta.size),
      'content-disposition': `inline; filename="${meta.name.replace(/"/g, '')}"`,
      'cache-control': meta.visibility === 'public' ? 'public, max-age=300' : 'private, no-store',
    },
  });
}

// PATCH /api/v1/files/:id — { visibility: "public" | "private" }.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { visibility?: string };
  const updated = await setVisibility(id, String(body.visibility ?? ''), gate.user.email ?? '', gate.user.role === 'admin');
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(updated);
}

// DELETE /api/v1/files/:id
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const ok = await deleteFile(id, gate.user.email ?? '', gate.user.role === 'admin');
  return ok ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
