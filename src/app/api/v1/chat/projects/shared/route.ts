import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { listSharedProjects } from '@/lib/chat';

export const dynamic = 'force-dynamic';

// Projects shared WITH the caller (they're a member of, not the owner) — "Shared with me".
export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ projects: await listSharedProjects(email) });
}
