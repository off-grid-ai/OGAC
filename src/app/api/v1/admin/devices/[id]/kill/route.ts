import { NextResponse } from 'next/server';
import { queueKill } from '@/lib/store';

// Admin triggers the kill switch for a device; the node executes it on next command poll.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cmd = await queueKill(id);
  if (!cmd) {
    return NextResponse.json({ error: 'unknown device' }, { status: 404 });
  }
  return NextResponse.json(cmd, { status: 202 });
}
