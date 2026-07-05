import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { keycloakAdmin } from '@/lib/keycloak-admin';

export const dynamic = 'force-dynamic';

// DELETE → revoke a single Keycloak session by its id.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    await kc.deleteSession(id);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.session.revoke',
      resource: `session:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
