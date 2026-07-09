import { NextResponse, type NextRequest } from 'next/server';
import { requireUser } from '@/lib/authz';
import { deletePrompt, getPrompt, incrementUses, updatePrompt } from '@/lib/prompts';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// A single prompt. Reads are allowed for org-visible prompts or the owner's own; mutations are
// owner-only. PATCH with { use: true } bumps the usage counter (called on copy). Every DB access is
// org-scoped: a prompt id belonging to another tenant resolves to null → 404 (no cross-tenant
// read/edit/delete even when the guessed id exists in another org).
type Ctx = { params: Promise<{ id: string }> };

function canView(p: { owner: string; visibility: string }, email: string): boolean {
  return p.visibility === 'org' || p.owner === email;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const p = await getPrompt(id, await currentOrgId());
  if (!p || !canView(p, gate.user.email ?? '')) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ prompt: p });
}

// eslint-disable-next-line complexity
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const email = gate.user.email ?? '';
  const { id } = await params;
  const orgId = await currentOrgId();
  const p = await getPrompt(id, orgId);
  if (!p || !canView(p, email)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  // Any viewer may record a use (copy). Everything else is owner-only.
  if (body.use === true) {
    await incrementUses(id, orgId);
    return NextResponse.json({ ok: true });
  }
  if (p.owner !== email) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await updatePrompt(
    id,
    {
      title: typeof body.title === 'string' ? body.title : undefined,
      content: typeof body.content === 'string' ? body.content : undefined,
      tags: body.tags,
      visibility: body.visibility,
    },
    orgId,
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const p = await getPrompt(id, orgId);
  if (!p) return NextResponse.json({ ok: true });
  if (p.owner !== (gate.user.email ?? '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  await deletePrompt(id, orgId);
  return NextResponse.json({ ok: true });
}
