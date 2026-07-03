import { NextResponse } from 'next/server';
import { deleteAgentRun, getAgentRun } from '@/lib/agentrun';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// GET → one run's full trace (steps + checks + citations + provenance) for the detail drill-in.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const run = await getAgentRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  return NextResponse.json(run);
}

// DELETE → purge a run record (D). Always allowed per lib/agent-run-actions.canDelete.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const removed = await deleteAgentRun(id);
  if (!removed) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  return NextResponse.json({ ok: true, deleted: id, by: gate.user.email });
}
