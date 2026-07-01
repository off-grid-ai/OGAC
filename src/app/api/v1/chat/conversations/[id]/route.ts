import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteConversation, getConversation, listMessages, renameConversation } from '@/lib/chat';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const conversation = await getConversation(userId, id);
  if (!conversation) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ conversation, messages: await listMessages(id) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const { title } = await req.json().catch(() => ({}));
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
