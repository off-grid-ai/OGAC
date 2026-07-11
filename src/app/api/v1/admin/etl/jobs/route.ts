import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import type { EtlJobDraft } from '@/lib/etl-job';
import { createEtlJob, listEtlJobs } from '@/lib/etl-jobs-store';
import { currentOrgId } from '@/lib/tenancy';

// ETL jobs — the authored data-movement specs. Admin-gated, org-scoped. GET lists; POST creates.
// Validation is the PURE validateJobDraft (in etl-job.ts), invoked inside createEtlJob so the same
// rule runs here and client-side.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({ object: 'list', data: await listEtlJobs(orgId) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as EtlJobDraft | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const orgId = await currentOrgId();
  const result = await createEtlJob(body, orgId);
  if (!result.ok) {
    return NextResponse.json({ error: result.errors.join(' ') }, { status: 400 });
  }
  auditFromSession(gate, orgId, {
    action: 'etl.job.create',
    resource: `etl-job:${result.job.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(result.job, { status: 201 });
}
