import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { getPipeline, listPipelinesByTeam, setPipelineTeam } from '@/lib/pipelines';
import { getTeam } from '@/lib/teams';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// A team's GOVERNED pipelines, managed from the team detail (the mirror of the pipeline Overview's
// team selector — one rule, two entry points). GET lists the pipelines assigned to this team; POST
// binds a pipeline to it (body { pipelineId }). Admin-gated, org-scoped, audited. Binding a pipeline
// is metadata (setPipelineTeam) — it does NOT bump the pipeline's governance version.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const team = await getTeam(id, orgId);
  if (!team) return NextResponse.json({ error: 'unknown team' }, { status: 404 });
  const bound = await listPipelinesByTeam(id, orgId);
  return NextResponse.json({
    object: 'list',
    data: bound.map((p) => ({ id: p.id, name: p.name, status: p.status })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const team = await getTeam(id, orgId);
  if (!team) return NextResponse.json({ error: 'unknown team' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { pipelineId?: unknown } | null;
  const pipelineId = typeof body?.pipelineId === 'string' ? body.pipelineId.trim() : '';
  if (!pipelineId) return NextResponse.json({ error: 'pipelineId is required' }, { status: 400 });

  const pipeline = await getPipeline(pipelineId, orgId);
  if (!pipeline) return NextResponse.json({ error: 'unknown pipeline' }, { status: 400 });

  const updated = await setPipelineTeam(pipelineId, id, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown pipeline' }, { status: 400 });
  auditFromSession(gate, orgId, {
    action: 'pipeline.team',
    resource: `pipeline:${pipelineId}`,
    outcome: 'ok',
  });
  return NextResponse.json({ id: updated.id, name: updated.name, status: updated.status }, {
    status: 201,
  });
}
