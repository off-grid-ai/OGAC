import { NextResponse } from 'next/server';
import { airbyteEtl } from '@/lib/adapters/airbyte';
import { auditFromSession } from '@/lib/audit-actor';
import { requireWriter } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// POST a state reset: clear the connection's saved replication state so the next sync re-reads from
// scratch (the guarded "reset state" control). Destructive-ish (re-reads everything) so it's a
// deliberate action behind a confirmation in the UI. Audited.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const org = await currentOrgId();
  const job = await airbyteEtl.resetConnection(id);
  auditFromSession(gate, org, {
    action: 'data.airbyte.reset',
    resource: `connection:${id} job=${job?.jobId ?? 'none'}`,
    outcome: job ? 'ok' : 'error',
  });
  if (!job) {
    return NextResponse.json(
      { error: 'reset failed or Airbyte unreachable' },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, connectionId: id, job });
}
