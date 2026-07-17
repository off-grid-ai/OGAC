import { NextResponse } from 'next/server';
import { deleteSchedule, setSchedulePaused } from '@/lib/adapters/agentruntime';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// PATCH → pause / resume a schedule. Body: { paused: boolean }.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { paused?: unknown } | null;
  if (typeof body?.paused !== 'boolean') {
    return NextResponse.json({ error: 'body { paused: boolean } required' }, { status: 400 });
  }
  const res = await setSchedulePaused(decodeURIComponent(id), body.paused, await currentOrgId());
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, scheduleId: res.scheduleId, paused: body.paused });
}

// DELETE → remove a schedule.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const res = await deleteSchedule(decodeURIComponent(id), await currentOrgId());
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, scheduleId: res.scheduleId });
}
