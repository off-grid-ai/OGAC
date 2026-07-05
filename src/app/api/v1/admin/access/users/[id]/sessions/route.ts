import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { normalizeSessions, type KcRawSession } from '@/lib/keycloak-realm';

export const dynamic = 'force-dynamic';

// GET → a user's active Keycloak sessions (normalized + sorted).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const raw = (await kc.listUserSessions(id)) as KcRawSession[];
    return NextResponse.json({ configured: true, sessions: normalizeSessions(raw) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// DELETE → log the user out of ALL sessions (POST /users/{id}/logout under the hood).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    await kc.logoutUser(id);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.session.logout',
      resource: `user:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
