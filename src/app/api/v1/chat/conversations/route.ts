import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createConversation, getSkill, listConversations, projectAccess } from '@/lib/chat';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ conversations: await listConversations(userId) });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { projectId = null, skillId = null } = await req.json().catch(() => ({}));
  const role = session.user.role ?? 'viewer';
  // Can't bind a conversation to a project or skill you don't have access to.
  if (projectId && !(await projectAccess(userId, projectId, role)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (skillId) {
    const s = await getSkill(skillId);
    const permitted =
      s && (role === 'admin' || (s.enabled && (!s.allowedRoles?.length || s.allowedRoles.includes(role))));
    if (!permitted) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const id = await createConversation(userId, projectId, skillId);
  return NextResponse.json({ id });
}
