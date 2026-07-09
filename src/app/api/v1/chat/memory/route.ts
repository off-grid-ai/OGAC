import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { addMemory, deleteMemory, listMemory } from '@/lib/chat';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Per-user memory management — list, add a manual fact, delete a fact. Scoped to the caller AND the
// host-bound tenant (currentOrgId): a user's memory on one tenant subdomain is isolated from another.
export async function GET() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ memory: await listMemory(userId, await currentOrgId()) });
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fact = '' } = await req.json().catch(() => ({}));
  await addMemory(userId, await currentOrgId(), String(fact), 'manual');
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id = '' } = await req.json().catch(() => ({}));
  await deleteMemory(userId, await currentOrgId(), String(id));
  return NextResponse.json({ ok: true });
}
