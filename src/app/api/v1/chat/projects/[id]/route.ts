import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteProject, updateProject } from '@/lib/chat';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const patch = await req.json().catch(() => ({}));
  await updateProject(userId, id, {
    name: patch.name,
    description: patch.description,
    systemPrompt: patch.systemPrompt,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  await deleteProject(userId, id);
  return NextResponse.json({ ok: true });
}
