import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { deleteGateway, getGatewayWithHealth } from '@/lib/gateways';

export const dynamic = 'force-dynamic';

// One gateway: read (with live health) or delete. Admin-gated, org-scoped, audited.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const gw = await getGatewayWithHealth(id, orgId);
  if (!gw) return NextResponse.json({ error: 'unknown gateway' }, { status: 404 });
  return NextResponse.json(gw);
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
