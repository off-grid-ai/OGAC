import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { deleteGateway, getGatewayWithHealth, updateGateway } from '@/lib/gateways';
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

  // Pure validation — egressClass is RE-DERIVED from kind here, never trusted from the client.
  const result = validateGatewayUpdate({
    name: body?.name,
    kind: body?.kind,
    baseUrl: body?.baseUrl,
    defaultModel: body?.defaultModel,
    enabled: body?.enabled,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const orgId = await currentOrgId();
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
