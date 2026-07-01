import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { listIngestJobs } from '@/lib/store';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listIngestJobs() });
}
