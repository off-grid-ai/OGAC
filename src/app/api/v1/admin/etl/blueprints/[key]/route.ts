import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { provisionManagedEtlBlueprint } from '@/lib/etl-jobs-store';
import { currentOrgId } from '@/lib/tenancy';

// Idempotent fleet bootstrap boundary. It creates/repairs the product-owned workflow as an ordinary
// ETL job, so operators see one canonical owner in the Console and use the normal run/history APIs.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { key } = await params;
  const orgId = await currentOrgId();
  const job = await provisionManagedEtlBlueprint(key, orgId);
  if (!job) return NextResponse.json({ error: 'unknown ETL blueprint' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'etl.blueprint.provision',
    resource: `etl-job:${job.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(job);
}
