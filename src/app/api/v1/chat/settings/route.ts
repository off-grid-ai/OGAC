import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getCustomInstructions, setCustomInstructions } from '@/lib/chat';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ customInstructions: await getCustomInstructions(userId) });
}

export async function PUT(req: Request) {
  const session = await auth();
  const userId = session?.user?.email;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { customInstructions = '' } = await req.json().catch(() => ({}));
  await setCustomInstructions(userId, String(customInstructions).slice(0, 4000));
  return NextResponse.json({ ok: true });
}
