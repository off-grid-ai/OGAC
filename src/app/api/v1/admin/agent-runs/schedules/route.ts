import { NextResponse } from 'next/server';
import { createSchedule, listSchedules } from '@/lib/adapters/agentruntime';
import { requireAdmin } from '@/lib/authz';
import { toScheduleSpec } from '@/lib/temporal-schedules';

export const dynamic = 'force-dynamic';

// GET → all Temporal Schedules that fire agent runs (recurring/cron). Graceful when Temporal is
// unconfigured/unreachable: empty view + note, never a 5xx.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const view = await listSchedules();
  return NextResponse.json(view);
}

// POST → create a recurring agent-run schedule (cron spec → AgentRunWorkflow). Validation is pure
// (toScheduleSpec throws on bad input → 400). A Temporal failure returns 502 with the error.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  let spec;
  try {
    spec = toScheduleSpec(body);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const res = await createSchedule(spec);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, scheduleId: res.scheduleId, by: gate.user.email }, { status: 201 });
}
