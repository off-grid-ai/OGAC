import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { KeycloakError } from '@/lib/keycloak-admin';
import { createGatewayKey, keycloakConfigured, listGatewayKeys } from '@/lib/gateway-api-keys';

export const dynamic = 'force-dynamic';

// GET /api/v1/admin/gateway-keys — list every Keycloak-backed gateway API key (no secrets).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!keycloakConfigured()) return NextResponse.json({ configured: false, keys: [] });
  try {
    const keys = await listGatewayKeys();
    return NextResponse.json({ configured: true, keys }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const status = err instanceof KeycloakError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}

// POST /api/v1/admin/gateway-keys — mint a new Keycloak-backed gateway API key. The opaque key
// (`ogk_<clientId>.<secret>`) is returned ONCE and never stored in cleartext.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!keycloakConfigured()) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as { name?: string; ownerOrg?: string } | null;
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const org = await currentOrgId();
  try {
    const { view, apiKey } = await createGatewayKey({ name: body.name, ownerOrg: body.ownerOrg ?? org });
    auditFromSession(gate, org, {
      action: 'access.machine.issue',
      resource: `gateway-key:${view.clientId}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, key: view, apiKey }, { status: 201 });
  } catch (err) {
    const status = err instanceof KeycloakError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
