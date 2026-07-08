import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getExportTarget } from '@/lib/exporters/store';
import { runExport } from '@/lib/exporters/run';

export const dynamic = 'force-dynamic';

// Run an export NOW for one target — pulls the spine slice for its kind (audit / metrics) and ships
// it to the configured endpoint, persisting the honest outcome. Admin-gated, org-scoped, audited.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const existing = await getExportTarget(id, orgId);
  if (!existing) return NextResponse.json({ error: 'unknown export target' }, { status: 404 });

  const result = await runExport(id, orgId);
  auditFromSession(gate, orgId, {
    action: 'exporter.run',
    resource: `exporter:${id}`,
    outcome: result.ok ? 'ok' : 'error',
  });
  return NextResponse.json(result);
}
