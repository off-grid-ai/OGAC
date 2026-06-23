import { NextResponse } from 'next/server';
import { listPolicyHistory } from '@/lib/store';

// Every published policy version (append-only) — newest first.
export async function GET() {
  return NextResponse.json({ object: 'list', data: await listPolicyHistory() });
}
