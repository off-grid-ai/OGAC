import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { keycloakAdmin } from '@/lib/keycloak-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const secret = await kc.getClientSecret(id);
    // Reading a live client secret in plaintext is a privileged, repeatable action — audit every
    // retrieval so there's an accountability trail of who viewed which client's secret when.
    // (P0 — HARDENING_AUDIT.md; the POST/rotate path already audited, the GET did not.)
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.machine.secret.read',
      resource: `client:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, secret });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
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
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
