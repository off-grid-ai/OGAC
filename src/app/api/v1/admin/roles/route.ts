import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { createCustomRole, listCustomRoles } from '@/lib/store';

const BASE_ROLES = ['viewer', 'operator', 'admin'];

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Tenant-scoped (SECURITY WAVE 1): returns only the caller's org roles.
  return NextResponse.json({ object: 'list', data: await listCustomRoles(await currentOrgId()) });
}

// eslint-disable-next-line complexity
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = b?.name as string | undefined;
  if (!name || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const basedOn = (b?.basedOn as string | undefined) ?? 'viewer';
  if (!BASE_ROLES.includes(basedOn)) {
    return NextResponse.json({ error: 'basedOn must be viewer | operator | admin' }, { status: 400 });
  }
  const caps = Array.isArray(b?.capabilities) ? (b!.capabilities as string[]) : [];
  const org = await currentOrgId();
  const created = await createCustomRole(
    {
      name,
      description: (b?.description as string | undefined) ?? '',
      basedOn,
      capabilities: caps,
    },
    org,
  );
  auditFromSession(gate, org, {
    action: 'access.role.change',
    resource: `role:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
