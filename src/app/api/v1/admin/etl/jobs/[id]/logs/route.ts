import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { getEtlJob, getEtlRun, getRunLogs } from '@/lib/etl-jobs-store';

// Execution logs for a specific run of a job — fetched live from the orchestration engine.
// Admin-gated, org-scoped. `?runId=` selects the run; returns [] when the run isn't orchestrated or
// the engine is unreachable (honest empty, never a 500). GET-only.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const orgId = await currentOrgId();
  const job = await getEtlJob(id, orgId);
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const runId = new URL(req.url).searchParams.get('runId');
  if (!runId) return NextResponse.json({ error: 'runId query param is required' }, { status: 400 });
  const run = await getEtlRun(runId, orgId);
  if (!run || run.jobId !== id) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  const logs = await getRunLogs(run);
  return NextResponse.json({ object: 'list', data: logs });
}
