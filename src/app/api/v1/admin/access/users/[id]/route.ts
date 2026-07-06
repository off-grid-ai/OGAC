import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const [user, realmRoles] = await Promise.all([
      kc.getUser(id),
      kc.listUserRoles(id),
    ]);

    if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 });

    return NextResponse.json({ configured: true, user: { ...user, realmRoles: realmRoles.map((r) => r.name) } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const org = await currentOrgId();
  try {
    await kc.updateUser(id, body);
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

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const org = await currentOrgId();
  try {
    await kc.deleteUser(id);
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
