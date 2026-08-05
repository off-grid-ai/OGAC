import { NextResponse } from 'next/server';
import { airbyteEtl } from '@/lib/adapters/airbyte';
import { auditFromSession } from '@/lib/audit-actor';
import { requireWriter } from '@/lib/authz';
import { isEtlConnectionVisible } from '@/lib/etl-scope';
import { currentOrgId } from '@/lib/tenancy';
import {
  buildScheduleUpdate,
  normalizeConnectionDetail,
  type ScheduleInput,
} from '@/lib/airbyte-schedule-model';

export const dynamic = 'force-dynamic';

// PATCH a connection's schedule (manual / basic-interval / cron). Read the current connection, let
// the pure model validate + reshape it into a ConnectionUpdate, then post it back. Audited. Thin:
// every decision is in buildScheduleUpdate; this only fetches, posts, and records.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  let body: ScheduleInput;
  try {
    body = (await req.json()) as ScheduleInput;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const org = await currentOrgId();
  // Same boundary as the detail route — a writer in one org must not reschedule another org's
  // connection by guessing its id.
  if (!(await isEtlConnectionVisible(id))) {
    return NextResponse.json(
      { error: 'connection not found or Airbyte unreachable' },
      { status: 404 },
    );
  }
  const raw = await airbyteEtl.getConnectionRaw(id);
  if (!raw) {
    return NextResponse.json(
      { error: 'connection not found or Airbyte unreachable' },
      { status: 404 },
    );
  }

  const built = buildScheduleUpdate(raw, body);
  if (!built.ok) {
    auditFromSession(gate, org, {
      action: 'data.airbyte.schedule',
      resource: `connection:${id} rejected(${built.error})`,
      outcome: 'blocked',
    });
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  const ok = await airbyteEtl.updateConnectionConfirmed(
    built.update,
    id,
    (raw) => normalizeConnectionDetail(raw).scheduleType === body.type,
  );
  auditFromSession(gate, org, {
    action: 'data.airbyte.schedule',
    resource: `connection:${id} schedule=${body.type}`,
    outcome: ok ? 'ok' : 'error',
  });
  if (!ok) {
    return NextResponse.json({ error: 'Airbyte rejected the schedule update' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, connectionId: id, scheduleType: body.type });
}
