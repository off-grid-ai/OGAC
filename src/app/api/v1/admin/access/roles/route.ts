import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { keycloakAdmin } from '@/lib/keycloak-admin';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  try {
    const roles = await kc.listRealmRoles();
    return NextResponse.json({ configured: true, roles });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const kc = keycloakAdmin();
  if (!kc) return NextResponse.json({ configured: false });

  const body = (await req.json().catch(() => null)) as { name?: string; description?: string } | null;
  if (!body?.name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const org = await currentOrgId();
  try {
    await kc.createRealmRole(body.name, body.description);
    auditFromSession(gate, org, {
      action: 'access.role.change',
      resource: `role:${body.name}`,
      outcome: 'ok',
    });
    return NextResponse.json({ configured: true, ok: true }, { status: 201 });
  } catch (err) {
    auditFromSession(gate, org, {
      action: 'access.role.change',
      resource: `role:${body.name}`,
      outcome: 'error',
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
