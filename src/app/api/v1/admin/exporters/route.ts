import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { validateExportTarget } from '@/lib/exporters/config';
import { createExportTarget, listExportTargets } from '@/lib/exporters/store';
import { EXPORTER_CATALOG } from '@/lib/exporters/types';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Spine exporters collection (M6 "good citizen"). Export audit/lineage/metrics OUT to the
// enterprise's own SIEM/catalog/observability. Admin-gated, org-scoped, audited. Pure validation in
// exporters/config.ts; persistence in exporters/store.ts.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({
    object: 'list',
    data: await listExportTargets(orgId),
    catalog: EXPORTER_CATALOG,
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const check = validateExportTarget({
    kind: body?.kind,
    endpoint: body?.endpoint,
    enabled: body?.enabled,
    secretRef: body?.secretRef,
  });
  if (!check.ok || !check.value) {
    return NextResponse.json(
      { error: check.errors.join('; '), errors: check.errors },
      { status: 400 },
    );
  }

  const orgId = await currentOrgId();
  const created = await createExportTarget(check.value, orgId);
  auditFromSession(gate, orgId, {
    action: 'exporter.create',
    resource: `exporter:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
