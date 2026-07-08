import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { createAsset, listAssets } from '@/lib/data-catalog-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Data catalog (M4) — "what data do I have". Admin-gated, org-scoped, thin. Pure model in
// data-classification.ts; persistence in data-catalog-store.ts.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listAssets(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = String(body?.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const sla = Number(body?.freshnessSlaHours);
  const rows = Number(body?.rowCount);
  const orgId = await currentOrgId();
  const created = await createAsset(
    {
      name,
      source: String(body?.source ?? '').trim(),
      connectorId: body?.connectorId ? String(body.connectorId) : null,
      domainId: body?.domainId ? String(body.domainId) : null,
      kind: body?.kind ? String(body.kind) : 'table',
      owner: String(body?.owner ?? '').trim(),
      description: String(body?.description ?? '').trim(),
      rowCount: Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 0,
      freshnessSlaHours: Number.isFinite(sla) && sla > 0 ? Math.floor(sla) : 0,
    },
    orgId,
  );
  auditFromSession(gate, orgId, {
    action: 'data-asset.create',
    resource: `data-asset:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
