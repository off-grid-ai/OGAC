import { NextResponse } from 'next/server';
import { airbyteEtl } from '@/lib/adapters/airbyte';
import { requireAdmin } from '@/lib/authz';
import { normalizeConnectionDetail } from '@/lib/airbyte-schedule-model';

export const dynamic = 'force-dynamic';

// Connection detail (the schedule/sync-mode management surface's read side): the raw ConnectionRead
// from Airbyte, normalized to the compact console detail view. Thin — the adapter does the I/O, the
// pure model does every shaping decision. 404 when Airbyte is unreachable or the id is unknown.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const raw = await airbyteEtl.getConnectionRaw(id);
  if (!raw) {
    return NextResponse.json(
      { error: 'connection not found or Airbyte unreachable' },
      { status: 404 },
    );
  }
  return NextResponse.json({ connection: normalizeConnectionDetail(raw) });
}
