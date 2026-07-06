import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const org = await currentOrgId();
  try {
    await kc.deleteRealmRole(name);
    auditFromSession(gate, org, {
      action: 'access.role.change',
      resource: `role:${name}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    auditFromSession(gate, org, {
      action: 'access.role.change',
      resource: `role:${name}`,
      outcome: 'error',
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
