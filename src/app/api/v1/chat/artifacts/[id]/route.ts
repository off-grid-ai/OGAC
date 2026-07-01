import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteArtifact } from '@/lib/chat';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  await deleteArtifact(userId, id);
  return NextResponse.json({ ok: true });
}
