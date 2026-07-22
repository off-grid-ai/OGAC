import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { serviceErrorMessage, serviceErrorStatus } from '@/lib/schema-model';
import { rollbackModelLive } from '@/lib/warehouse-model-service';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Roll a governed analytical model back to a prior version: re-apply that version's FROZEN DDL live
// to ClickHouse, then move the current-version pointer. The migration trail is preserved (newer
// versions aren't deleted). Admin-gated; audited.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { version?: unknown } | null;
  const version = Number(body?.version);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: 'a positive integer "version" is required' }, { status: 400 });
  }
  const org = await currentOrgId();
  const result = await rollbackModelLive(id, version, org);
  if (!result.ok) {
    auditFromSession(gate, org, {
      action: 'warehouse.model.rollback',
      resource: `warehouse:model ${id} → v${version} rejected(${serviceErrorMessage(result)})`,
      outcome: 'blocked',
    });
    return NextResponse.json({ error: serviceErrorMessage(result) }, { status: serviceErrorStatus(result.kind) });
  }
  auditFromSession(gate, org, {
    action: 'warehouse.model.rollback',
    resource: `warehouse:model ${id} rolled back to v${version}`,
    outcome: 'ok',
  });
  return NextResponse.json({ model: result.value });
}
