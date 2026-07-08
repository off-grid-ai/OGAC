import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getEtlJob, runJob } from '@/lib/etl-jobs-store';

// Run an ETL job now — the governed direct-copy: source connector → redact on path → warehouse.
// Admin-gated, org-scoped. Records the run (audit/lineage) and returns the run view (status, rows,
// redacted count). runJob never throws — a failure comes back as a failed run with a message.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const orgId = await currentOrgId();
  const job = await getEtlJob(id, orgId);
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const run = await runJob(job, orgId);
  auditFromSession(gate, orgId, {
    action: 'etl.job.run',
    resource: `etl-job:${id}`,
    outcome: run.status === 'succeeded' ? 'ok' : 'error',
  });
  return NextResponse.json(run, { status: run.status === 'failed' ? 502 : 200 });
}
