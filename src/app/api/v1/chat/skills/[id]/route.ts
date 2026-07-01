import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteSkill, updateSkill } from '@/lib/chat';

export const dynamic = 'force-dynamic';

// Admin-only skill mutations. Edit any field (instructions/model/roles/knowledge project) or delete.
// eslint-disable-next-line complexity
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const k of ['name', 'description', 'systemPrompt', 'model', 'icon', 'enabled'] as const) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (body.projectId !== undefined) patch.projectId = body.projectId ?? null;
  if (Array.isArray(body.allowedRoles)) patch.allowedRoles = body.allowedRoles;
  await updateSkill(id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { id } = await params;
  await deleteSkill(id);
  return NextResponse.json({ ok: true });
}
