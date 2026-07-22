import { NextResponse } from 'next/server';
import { airbyteEtl } from '@/lib/adapters/airbyte';
import { auditFromSession } from '@/lib/audit-actor';
import { requireWriter } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import {
  buildSyncModeUpdate,
  normalizeConnectionDetail,
  type SyncModeChoice,
} from '@/lib/airbyte-schedule-model';

export const dynamic = 'force-dynamic';

// PATCH one stream's sync mode (full-refresh/incremental × overwrite/append/dedup). The pure model
// enforces the invariants Airbyte would otherwise reject (incremental needs a cursor, dedup needs a
// primary key) BEFORE any write. Audited. Thin.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  let body: { stream?: string; mode?: SyncModeChoice };
  try {
    body = (await req.json()) as { stream?: string; mode?: SyncModeChoice };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const org = await currentOrgId();
  const raw = await airbyteEtl.getConnectionRaw(id);
  if (!raw) {
    return NextResponse.json(
      { error: 'connection not found or Airbyte unreachable' },
      { status: 404 },
    );
  }

  const built = buildSyncModeUpdate(raw, body.stream ?? '', body.mode as SyncModeChoice);
  if (!built.ok) {
    auditFromSession(gate, org, {
      action: 'data.airbyte.sync-mode',
      resource: `connection:${id} stream:${body.stream ?? '?'} rejected(${built.error})`,
      outcome: 'blocked',
    });
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  const ok = await airbyteEtl.updateConnectionConfirmed(built.update, id, (raw) =>
    normalizeConnectionDetail(raw).streams.some(
      (s) => s.name === (body.stream ?? '') && s.syncMode === (body.mode as SyncModeChoice),
    ),
  );
  auditFromSession(gate, org, {
    action: 'data.airbyte.sync-mode',
    resource: `connection:${id} stream:${body.stream} mode=${body.mode}`,
    outcome: ok ? 'ok' : 'error',
  });
  if (!ok) {
    return NextResponse.json({ error: 'Airbyte rejected the sync-mode update' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, connectionId: id, stream: body.stream, mode: body.mode });
}
