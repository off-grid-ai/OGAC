import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { listDriftRuns } from '@/lib/drift-runs';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The retained drift-run history for the caller's org — each row carries its engine attribution
// (real Evidently execution vs the PSI fallback) so drift is auditable after the fact.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const runs = await listDriftRuns(20, await currentOrgId());
  return NextResponse.json({ object: 'list', data: runs });
}
