import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { listPolicyHistory } from '@/lib/store';

// Every published policy version (append-only) — newest first.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listPolicyHistory() });
}
