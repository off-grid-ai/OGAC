import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getEtlJob, runJobViaKestra } from '@/lib/etl-jobs-store';

// Run an ETL job now. Compiles the job's DAG → an orchestration flow, deploys it to the engine, and
// triggers an execution (the engine runs it asynchronously; status is polled via GET .../runs).
// Jobs authored before the visual builder (no DAG) fall back to the governed direct-copy. Admin-
// gated, org-scoped, audited/lineage'd. runJobViaKestra never throws — an unreachable/unconfigured
// engine comes back as a FAILED run with an honest message (never a fake success).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const orgId = await currentOrgId();
  const job = await getEtlJob(id, orgId);
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const run = await runJobViaKestra(job, orgId);
  auditFromSession(gate, orgId, {
    action: 'etl.job.run',
    resource: `etl-job:${id}`,
    outcome: run.status === 'failed' ? 'error' : 'ok',
  });
  return NextResponse.json(run, { status: run.status === 'failed' ? 502 : 200 });
}
