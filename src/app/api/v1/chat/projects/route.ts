import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createProject, listProjects } from '@/lib/chat';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ projects: await listProjects(userId) });
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { name = 'New project', systemPrompt = '' } = await req.json().catch(() => ({}));
  const id = await createProject(userId, name, systemPrompt);
  return NextResponse.json({ id });
}
