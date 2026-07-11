import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Report ONLY whether a client secret is configured — never the secret value. A client secret is a
// bearer credential: returning it here made it a repeatable, un-scoped exfiltration endpoint. The
// cleartext secret is revealed exactly ONCE, at create/rotate time (the POST below). The UI uses this
// boolean to show "configured / rotate" state. (P1 — cross-tenant/secret-exposure audit.)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const secret = await kc.getClientSecret(id);
    return NextResponse.json({ configured: Boolean(secret) });
  } catch (err) {
    console.error(`GET client secret status for ${id} failed:`, err);
    return NextResponse.json({ error: 'service unavailable' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const secret = await kc.regenerateClientSecret(id);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.machine.rotate',
      resource: `client:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, secret });
  } catch (err) {
    console.error(`rotate client secret for ${id} failed:`, err);
    return NextResponse.json({ error: 'service unavailable' }, { status: 500 });
  }
}
