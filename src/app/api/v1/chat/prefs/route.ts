import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getPrefs, setPrefs } from '@/lib/chat';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ prefs: await getPrefs(userId) });
}

export async function PUT(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { prefs = {} } = await req.json().catch(() => ({}));
  if (typeof prefs !== 'object' || prefs === null) {
    return NextResponse.json({ error: 'prefs must be an object' }, { status: 400 });
  }
  await setPrefs(userId, prefs as Record<string, unknown>);
  return NextResponse.json({ ok: true });
}
