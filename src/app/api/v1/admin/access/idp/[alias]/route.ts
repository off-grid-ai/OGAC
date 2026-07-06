import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { KeycloakError, keycloakAdmin } from '@/lib/keycloak-admin';
import { forbiddenGrantMessage } from '@/lib/keycloak-realm';

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
    const status = err instanceof KeycloakError ? err.status : 500;
    const message = forbiddenGrantMessage('manage-identity-providers', status, (err as Error).message);
    return NextResponse.json({ error: message }, { status });
  }
}
