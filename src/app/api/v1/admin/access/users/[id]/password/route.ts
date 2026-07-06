import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as { password?: string; temporary?: boolean } | null;
  if (!body?.password) {
    return NextResponse.json({ error: 'password is required' }, { status: 400 });
  }
  // Minimum length here for a clean 400 (Keycloak may enforce its own policy on top). P2 validation.
  if (body.password.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 });
  }

  const org = await currentOrgId();
  try {
    await kc.resetPassword(id, body.password, body.temporary ?? false);
    auditFromSession(gate, org, {
      action: 'access.user.change',
      resource: `user:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    auditFromSession(gate, org, {
      action: 'access.user.change',
      resource: `user:${id}`,
      outcome: 'error',
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
