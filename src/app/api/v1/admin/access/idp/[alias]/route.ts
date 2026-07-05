import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { keycloakAdmin } from '@/lib/keycloak-admin';

export const dynamic = 'force-dynamic';

// DELETE → remove an identity provider by alias.
export async function DELETE(req: Request, { params }: { params: Promise<{ alias: string }> }) {
  const { alias } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    await kc.deleteIdentityProvider(alias);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.idp.delete',
      resource: `idp:${alias}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
