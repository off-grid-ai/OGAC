import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireUser } from '@/lib/authz';
import { resolvePipelineRole } from '@/lib/pipeline-lifecycle';
import { roleAtLeast } from '@/lib/pipeline-lifecycle-model';
import { getPipeline, setPipelineTeam } from '@/lib/pipelines';
import { getTeam } from '@/lib/teams';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST /api/v1/admin/pipelines/[id]/team — assign or clear a pipeline's team (M2 team tier). Body:
// { teamId: string | null }. Authorized to the OWNER or org ADMIN (role ≥ editor on this pipeline).
// A non-null teamId must name a team in this org (else 400). Team is ownership metadata — moving a
// pipeline between teams does NOT bump the governance version. Audited `pipeline.team`.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const pipeline = await getPipeline(id, orgId);
  if (!pipeline) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });

  const actor = { email: gate.user.email ?? '', role: gate.user.role };
  const role = await resolvePipelineRole(actor, pipeline, orgId);
  if (!roleAtLeast(role, 'editor')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { teamId?: unknown } | null;
  const raw = body?.teamId;
  const teamId = typeof raw === 'string' && raw.trim() ? raw.trim() : null;

  // A non-null team must exist in this org — never point a pipeline at a team it can't reach.
  if (teamId) {
    const team = await getTeam(teamId, orgId);
    if (!team) return NextResponse.json({ error: 'unknown team' }, { status: 400 });
  }

  const updated = await setPipelineTeam(id, teamId, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'pipeline.team',
    resource: `pipeline:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}
