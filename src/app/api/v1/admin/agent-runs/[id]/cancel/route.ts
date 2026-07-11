import { NextResponse } from 'next/server';
import { canCancel } from '@/lib/agent-run-actions';
import { cancelAgentRun, getAgentRun } from '@/lib/agentrun';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST → cancel an in-flight run (one held at pending_review) → terminal 'cancelled'. The pure
// state-machine (lib/agent-run-actions) gates which statuses are cancellable. Org-scoped: a
// cross-tenant run id resolves to 404 (never reads or cancels another tenant's run — IDOR blocked).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const prior = await getAgentRun(id, orgId);
  if (!prior) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (!canCancel(prior.status)) {
    return NextResponse.json({ error: `run status ${prior.status} is not cancellable` }, { status: 409 });
  }
  const run = await cancelAgentRun(id, orgId);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  return NextResponse.json({ ok: true, status: run.status, by: gate.user.email });
}
