import { NextResponse } from 'next/server';
import { deleteAgentRun, getAgentRun } from '@/lib/agentrun';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// GET → one run's full trace (steps + checks + citations + provenance) for the detail drill-in.
// Org-scoped: a run id from another tenant returns 404 (cross-tenant IDOR blocked).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const run = await getAgentRun(id, await currentOrgId());
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  return NextResponse.json(run);
}

// DELETE → purge a run record (D). Always allowed per lib/agent-run-actions.canDelete.
// Org-scoped: a cross-tenant delete-by-id matches no row → 404 (never purges another tenant's run).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const removed = await deleteAgentRun(id, await currentOrgId());
  if (!removed) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  return NextResponse.json({ ok: true, deleted: id, by: gate.user.email });
}
