import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { syncConnector } from '@/lib/store';

// Trigger an ingest run for a connector (creates an ingest job).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const job = await syncConnector(id);
  if (!job) {
    return NextResponse.json({ error: 'unknown connector' }, { status: 404 });
  }
  auditFromSession(gate, await currentOrgId(), {
    action: 'connector.sync',
    resource: `connector:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(job, { status: 202 });
}
