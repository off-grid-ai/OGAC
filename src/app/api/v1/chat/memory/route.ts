import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { addMemory, deleteMemory, listMemory } from '@/lib/chat';

export const dynamic = 'force-dynamic';

// Per-user memory management — list, add a manual fact, delete a fact. Scoped to the caller.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ memory: await listMemory(userId) });
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fact = '' } = await req.json().catch(() => ({}));
  await addMemory(userId, String(fact), 'manual');
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id = '' } = await req.json().catch(() => ({}));
  await deleteMemory(userId, String(id));
  return NextResponse.json({ ok: true });
}
