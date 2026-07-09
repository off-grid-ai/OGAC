import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  deleteConversation,
  getConversation,
  listMessages,
  renameConversation,
  switchBranch,
} from '@/lib/chat';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const conversation = await getConversation(userId, await currentOrgId(), id);
  if (!conversation) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ conversation, messages: await listMessages(id) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  // Ownership check (both actions mutate a conversation the caller must own, in this tenant).
  if (!(await getConversation(userId, await currentOrgId(), id))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const { title, branchMessageId, branchDelta } = await req.json().catch(() => ({}));
  // Branch navigation ‹ 2/3 ›: move among sibling versions of an edited/regenerated turn.
  if (typeof branchMessageId === 'string' && typeof branchDelta === 'number') {
    const ok = await switchBranch(id, branchMessageId, branchDelta);
    return NextResponse.json({ ok, messages: await listMessages(id) });
  }
  if (typeof title === 'string') await renameConversation(userId, id, title);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  await deleteConversation(userId, id);
  return NextResponse.json({ ok: true });
}
