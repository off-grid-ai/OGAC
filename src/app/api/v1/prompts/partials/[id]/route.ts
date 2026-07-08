import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/authz';
import { deletePartial, getPartial, updatePartial } from '@/lib/prompt-partials';

export const dynamic = 'force-dynamic';

// A single prompt partial. Reads are allowed for org-visible partials or the owner's own; mutations
// (PATCH/DELETE) are owner-only.
type Ctx = { params: Promise<{ id: string }> };

function canView(p: { owner: string; visibility: string }, email: string): boolean {
  return p.visibility === 'org' || p.owner === email;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const p = await getPartial(id);
  if (!p || !canView(p, gate.user.email ?? '')) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ partial: p });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const email = gate.user.email ?? '';
  const { id } = await params;
  const p = await getPartial(id);
  if (!p || !canView(p, email)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (p.owner !== email) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  await updatePartial(id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    title: typeof body.title === 'string' ? body.title : undefined,
    content: typeof body.content === 'string' ? body.content : undefined,
    visibility: body.visibility,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const p = await getPartial(id);
  if (!p) return NextResponse.json({ ok: true });
  if (p.owner !== (gate.user.email ?? '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  await deletePartial(id);
  return NextResponse.json({ ok: true });
}
