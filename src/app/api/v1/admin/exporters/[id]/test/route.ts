import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getExportTarget } from '@/lib/exporters/store';
import { testTarget } from '@/lib/exporters/run';

export const dynamic = 'force-dynamic';

// Test one export target's connection FOR REAL — resolves its secret from the vault, calls the
// exporter's real test() against the configured endpoint, persists the honest last-status. The
// response is the real ok/fail + detail; nothing is faked.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const existing = await getExportTarget(id, orgId);
  if (!existing) return NextResponse.json({ error: 'unknown export target' }, { status: 404 });

  const result = await testTarget(id, orgId);
  auditFromSession(gate, orgId, {
    action: 'exporter.test',
    resource: `exporter:${id}`,
    outcome: result.ok ? 'ok' : 'error',
  });
  return NextResponse.json(result);
}
