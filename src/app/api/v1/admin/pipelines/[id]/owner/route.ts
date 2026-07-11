import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireUser } from '@/lib/authz';
import { resolvePipelineRole } from '@/lib/pipeline-lifecycle';
import { roleAtLeast } from '@/lib/pipeline-lifecycle-model';
import { getPipeline, reassignPipelineOwner } from '@/lib/pipelines';
import { validateOwnerReassign } from '@/lib/teams-policy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST /api/v1/admin/pipelines/[id]/owner — reassign a pipeline's owner (M2 ownership). Body:
// { newOwnerId }. Authorized to the current OWNER or an org ADMIN (role ≥ editor on this pipeline).
// Owner is ownership metadata — reassigning does NOT bump the governance version. Audited
// `pipeline.reassign`.
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

  const body = (await req.json().catch(() => null)) as { newOwnerId?: unknown } | null;
  const check = validateOwnerReassign({
    currentOwnerId: pipeline.ownerId,
    newOwnerId: body?.newOwnerId,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.errors.join('; '), errors: check.errors }, { status: 400 });
  }

  const updated = await reassignPipelineOwner(id, check.ownerId, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'pipeline.reassign',
    resource: `pipeline:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}
