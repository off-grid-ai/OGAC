import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getEtlJob, listEtlRuns, refreshRunStatus } from '@/lib/etl-jobs-store';
import { currentOrgId } from '@/lib/tenancy';

// Run history for a job, with a live refresh of any orchestrated run still marked 'running' (polls
// the engine for its latest execution state and folds it back). Admin-gated, org-scoped. GET-only.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const orgId = await currentOrgId();
  const job = await getEtlJob(id, orgId);
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const runs = await listEtlRuns(id, orgId);
  const refreshed = await Promise.all(runs.map((r) => refreshRunStatus(r, orgId)));
  return NextResponse.json({ object: 'list', data: refreshed });
}
