import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { agentRuns } from '@/db/schema';
import { canReview } from '@/lib/agent-run-actions';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// S4 human-in-the-loop, on the agent-runs module surface: approve or reject a run held at
// pending_review. Approve → answer released (status done); reject → status rejected (answer
// withheld). Mirrors /agents/runs/[id]/review; gated by the pure state-machine. Auditable by actor.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const { decision } = (await req.json().catch(() => ({}))) as { decision?: 'approve' | 'reject' };
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision must be approve|reject' }, { status: 400 });
  }
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (!canReview(run.status)) {
    return NextResponse.json({ error: `run is ${run.status}, not pending_review` }, { status: 409 });
  }
  const status = decision === 'approve' ? 'done' : 'rejected';
  await db.update(agentRuns).set({ status }).where(eq(agentRuns.id, id));
  return NextResponse.json({ ok: true, status, by: gate.user.email });
}
