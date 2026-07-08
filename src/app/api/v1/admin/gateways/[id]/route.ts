import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { deleteGateway, getGatewayRow, getGatewayWithHealth, updateGateway } from '@/lib/gateways';
import { validateGatewayUpdate } from '@/lib/gateways-policy';

export const dynamic = 'force-dynamic';

// One gateway: read (with live health), update, or delete. Admin-gated, org-scoped, audited.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const gw = await getGatewayWithHealth(id, orgId);
  if (!gw) return NextResponse.json({ error: 'unknown gateway' }, { status: 404 });
  return NextResponse.json(gw);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const orgId = await currentOrgId();

  // PATCH is a PARTIAL update: merge the provided fields onto the current row, then validate the
  // MERGED shape (so a partial body — e.g. only `defaultModel` — persists instead of failing
  // create-validation or silently no-op'ing). `??` keeps an explicit empty string (clearing a
  // field) while falling back to the stored value only when a key is absent. (gap PA-10)
  const existing = await getGatewayRow(id, orgId);
  if (!existing) return NextResponse.json({ error: 'unknown gateway' }, { status: 404 });

  // Pure validation — egressClass is RE-DERIVED from kind in the store, never trusted from client.
  const result = validateGatewayUpdate({
    name: (body?.name as string | undefined) ?? existing.name,
    kind: (body?.kind as string | undefined) ?? existing.kind,
    baseUrl: (body?.baseUrl as string | undefined) ?? existing.baseUrl,
    defaultModel: (body?.defaultModel as string | undefined) ?? existing.defaultModel,
    enabled: typeof body?.enabled === 'boolean' ? body.enabled : existing.enabled,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const updated = await updateGateway(id, result.value, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown gateway' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'gateway.update',
    resource: `gateway:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const removed = await deleteGateway(id, orgId);
  if (!removed) return NextResponse.json({ error: 'unknown gateway' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'gateway.delete',
    resource: `gateway:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
