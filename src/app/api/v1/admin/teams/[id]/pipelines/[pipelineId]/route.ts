import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { getPipeline, setPipelineTeam } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Unbind a pipeline from this team (clears pipelines.team_id → the pipeline falls back to owner + org
// admin access). Admin-gated, org-scoped, audited. Idempotent 404 for a pipeline that isn't on this
// team so the UI never orphans a stale binding.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; pipelineId: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id, pipelineId } = await params;
  const orgId = await currentOrgId();

  const pipeline = await getPipeline(pipelineId, orgId);
  if (!pipeline || pipeline.teamId !== id) {
    return NextResponse.json({ error: 'pipeline is not on this team' }, { status: 404 });
  }

  const updated = await setPipelineTeam(pipelineId, null, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'pipeline.team',
    resource: `pipeline:${pipelineId}`,
    outcome: 'ok',
  });
  return NextResponse.json({ unbound: true });
}
