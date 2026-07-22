import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { isGovernedKafkaConnector } from '@/lib/adapters/kafka-source-onboarding';
import { requireAdmin } from '@/lib/authz';
import { syncConnector } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

// Trigger an ingest run for a connector (creates an ingest job).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  if (await isGovernedKafkaConnector(id, orgId)) {
    return NextResponse.json(
      {
        error: 'Manage this governed event source from its source page.',
        manageAt: '/api/v1/admin/kafka-sources',
      },
      { status: 409 },
    );
  }
  const job = await syncConnector(id, orgId);
  if (!job) {
    return NextResponse.json({ error: 'unknown connector' }, { status: 404 });
  }
  auditFromSession(gate, orgId, {
    action: 'connector.sync',
    resource: `connector:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(job, { status: 202 });
}
