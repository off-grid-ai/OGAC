import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { keycloakConfigured, revokeGatewayKey } from '@/lib/gateway-api-keys';
import { KeycloakError } from '@/lib/keycloak-admin';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// DELETE /api/v1/admin/gateway-keys/[id]?hard=true — revoke a gateway API key. Default disables the
// backing Keycloak client (reversible, keeps history); `hard=true` deletes it. Either way the key
// stops working immediately at the gateway.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  if (!keycloakConfigured()) return NextResponse.json({ configured: false });

  const hard = new URL(req.url).searchParams.get('hard') === 'true';
  try {
    await revokeGatewayKey(id, { hard });
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.machine.rotate',
      resource: `gateway-key:${id}`,
      outcome: 'blocked', // a revoke is a deny-forward — recorded as the key being cut off
    });
    return NextResponse.json({ ok: true, hard });
  } catch (err) {
    const status = err instanceof KeycloakError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
