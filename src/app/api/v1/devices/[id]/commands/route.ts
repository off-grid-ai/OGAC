import { NextResponse } from 'next/server';
import { takeCommands } from '@/lib/store';

// Node polls for pending commands (kill switch, re-provision). Returned commands are consumed.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ object: 'list', data: await takeCommands(id) });
}
