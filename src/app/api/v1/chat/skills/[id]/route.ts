import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteSkill, getSkill, updateSkill } from '@/lib/chat';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// A caller may mutate a skill if they're an admin (org-wide assistants) or the creator of a
// private one. Non-admins can never publish org-wide (visibility is pinned to 'private'). All
// lookups/mutations are tenant-scoped by orgId so a caller can only touch THEIR org's skills — a
// skill in another tenant resolves to null here and the mutation is refused.
async function canMutate(orgId: string, id: string, email: string, role: string) {
  const s = await getSkill(orgId, id);
  if (!s) return false;
  if (role === 'admin') return true;
  return Boolean(s.visibility === 'private' && s.createdBy === email);
}

// Edit assistant fields: instructions/model/roles/knowledge project + builder fields
// (conversation starters, capability toggles, Actions schema, visibility).
// eslint-disable-next-line complexity
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const role = session.user.role ?? 'viewer';
  const orgId = await currentOrgId();
  if (!(await canMutate(orgId, id, email, role)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const k of [
    'name',
    'description',
    'systemPrompt',
    'model',
    'icon',
    'enabled',
    'actionsSchema',
  ] as const) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (body.projectId !== undefined) patch.projectId = body.projectId ?? null;
  if (Array.isArray(body.allowedRoles)) patch.allowedRoles = body.allowedRoles;
  if (Array.isArray(body.conversationStarters)) {
    patch.conversationStarters = body.conversationStarters.filter(
      (s: unknown) => typeof s === 'string' && s.trim(),
    );
  }
  if (body.capabilities && typeof body.capabilities === 'object') {
    patch.capabilities = {
      web: Boolean(body.capabilities.web),
      tools: Boolean(body.capabilities.tools),
      code: Boolean(body.capabilities.code),
    };
  }
  // Only admins may promote an assistant to org-wide visibility.
  if (body.visibility !== undefined) {
    patch.visibility = role === 'admin' && body.visibility === 'org' ? 'org' : 'private';
  }
  await updateSkill(orgId, id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const role = session.user.role ?? 'viewer';
  const orgId = await currentOrgId();
  if (!(await canMutate(orgId, id, email, role)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await deleteSkill(orgId, id);
  return NextResponse.json({ ok: true });
}
