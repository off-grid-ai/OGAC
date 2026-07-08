import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { deleteEtlJob, getEtlJob, listEtlRuns, updateEtlJob } from '@/lib/etl-jobs-store';
import type { EtlJobDraft } from '@/lib/etl-job';

// A single ETL job — GET (spec + recent runs), PATCH (edit), DELETE. Admin-gated, org-scoped.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const orgId = await currentOrgId();
  const job = await getEtlJob(id, orgId);
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const runs = await listEtlRuns(id, orgId);
  return NextResponse.json({ job, runs });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const orgId = await currentOrgId();
  const body = (await req.json().catch(() => null)) as EtlJobDraft | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const result = await updateEtlJob(id, body, orgId);
  if (result === null) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.errors.join(' ') }, { status: 400 });
  auditFromSession(gate, orgId, {
    action: 'etl.job.update',
    resource: `etl-job:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(result.job);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await ctx.params;
  const orgId = await currentOrgId();
  const ok = await deleteEtlJob(id, orgId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'etl.job.delete',
    resource: `etl-job:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
