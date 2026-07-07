import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { listPipelineVersions } from '@/lib/pipelines';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/pipelines/[id]/versions — the immutable version history, newest first.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  return NextResponse.json({ object: 'list', data: await listPipelineVersions(id, orgId) });
}
