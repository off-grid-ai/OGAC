import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { listIngestJobs } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Scope to the caller's org — listIngestJobs was global (cross-tenant leak, P1).
  return NextResponse.json({ object: 'list', data: await listIngestJobs(await currentOrgId()) });
}
