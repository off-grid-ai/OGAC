import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { agentRuns } from '@/db/schema';
import { requireUser } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// S4 human-in-the-loop: approve or reject a run held at pending_review. Approve → the answer is
// released (status done); reject → status rejected (answer withheld). Auditable by actor.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const { decision } = (await req.json().catch(() => ({}))) as { decision?: 'approve' | 'reject' };
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision must be approve|reject' }, { status: 400 });
  }
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (run.status !== 'pending_review') {
    return NextResponse.json({ error: `run is ${run.status}, not pending_review` }, { status: 409 });
  }
  await db
    .update(agentRuns)
    .set({ status: decision === 'approve' ? 'done' : 'rejected' })
    .where(eq(agentRuns.id, id));
  return NextResponse.json({ ok: true, status: decision === 'approve' ? 'done' : 'rejected', by: gate.user.email });
}
