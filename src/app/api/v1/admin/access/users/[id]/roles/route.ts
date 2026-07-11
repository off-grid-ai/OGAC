import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin, type KcRole } from '@/lib/keycloak-admin';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const roles = await kc.listUserRoles(id);
    return NextResponse.json({ configured: true, roles });
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

  const body = (await req.json().catch(() => null)) as { roles?: KcRole[] } | null;
  if (!body?.roles || !Array.isArray(body.roles)) {
    return NextResponse.json({ error: 'roles array is required' }, { status: 400 });
  }

  try {
    await kc.assignRoles(id, body.roles);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.role.change',
      resource: `user:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as { roles?: KcRole[] } | null;
  if (!body?.roles || !Array.isArray(body.roles)) {
    return NextResponse.json({ error: 'roles array is required' }, { status: 400 });
  }

  try {
    await kc.removeRoles(id, body.roles);
    auditFromSession(gate, await currentOrgId(), {
      action: 'access.role.change',
      resource: `user:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
