import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { getGatewayRow, provisionGatewayHost } from '@/lib/gateways';
import { slugifyTenant } from '@/lib/tenant-domain';

export const dynamic = 'force-dynamic';

// PA-15 — PROVISION a per-tenant gateway HOST on an existing gateway.
//
// Mints "<slug5><rand5>-gateway.<apex>" (pure tenantGatewayHost + randomGatewaySuffix) from the
// tenant slug and stores it on the gateway row's `hostname`, so this gateway reads RESTfully like
// the tenant console subdomain. Admin-gated, org-scoped, audited. Thin handler: the host SHAPE +
// persistence live in src/lib (pure helper + gateways.ts store), this only wires request → store.
//
// Body: { tenantSlug: string } — the tenant to mint the host for (slugified server-side). The
// gateway must exist for the caller's org (org-scoped) or this 404s.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const body = (await req.json().catch(() => null)) as { tenantSlug?: unknown } | null;
  const tenantSlug = slugifyTenant(typeof body?.tenantSlug === 'string' ? body.tenantSlug : '');
  if (!tenantSlug) {
    return NextResponse.json({ error: 'tenantSlug is required' }, { status: 400 });
  }

  // 404 before minting so we never audit a host for a gateway that isn't the caller's.
  const existing = await getGatewayRow(id, orgId);
  if (!existing) return NextResponse.json({ error: 'unknown gateway' }, { status: 404 });

  const updated = await provisionGatewayHost(id, tenantSlug, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown gateway' }, { status: 404 });

  auditFromSession(gate, orgId, {
    action: 'gateway.provision-host',
    resource: `gateway:${id}:${updated.hostname}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}
