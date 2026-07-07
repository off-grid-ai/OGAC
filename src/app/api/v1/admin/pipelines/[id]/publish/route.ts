import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { publishPipeline } from '@/lib/pipelines';

export const dynamic = 'force-dynamic';

// POST /api/v1/admin/pipelines/[id]/publish — status → published, bump version, freeze a snapshot.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const by = gate.user.email ?? 'service@offgrid.local';
  const published = await publishPipeline(id, orgId, by);
  if (!published) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'pipeline.publish',
    resource: `pipeline:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(published);
}
