import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createConversation, listConversations } from '@/lib/chat';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ conversations: await listConversations(userId) });
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { projectId = null, skillId = null } = await req.json().catch(() => ({}));
  const id = await createConversation(userId, projectId, skillId);
  return NextResponse.json({ id });
}
