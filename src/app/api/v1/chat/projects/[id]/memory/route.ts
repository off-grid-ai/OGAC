import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  addProjectMemory,
  deleteProjectMemory,
  listProjectMemory,
  projectAccess,
} from '@/lib/chat';

export const dynamic = 'force-dynamic';

// Per-project memory — facts scoped to a project, injected into that project's chats. Viewable by
// anyone with access; editable by owner/editor/admin.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const access = await projectAccess(email, id, session.user.role ?? 'viewer');
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ memory: await listProjectMemory(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const access = await projectAccess(email, id, session.user.role ?? 'viewer');
  if (access !== 'owner' && access !== 'edit')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { fact = '' } = await req.json().catch(() => ({}));
  await addProjectMemory(id, String(fact), 'manual');
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const access = await projectAccess(email, id, session.user.role ?? 'viewer');
  if (access !== 'owner' && access !== 'edit')
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const memId = searchParams.get('memId');
  if (!memId) return NextResponse.json({ error: 'memId required' }, { status: 400 });
  await deleteProjectMemory(id, memId);
  return NextResponse.json({ ok: true });
}
