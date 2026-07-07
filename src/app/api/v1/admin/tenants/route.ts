import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { createTenant, listTenants } from '@/lib/store';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listTenants() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const name = body?.name as string | undefined;
  const plan = (body?.plan as string | undefined) ?? 'standard';
  const enabledModules = Array.isArray(body?.enabledModules) ? body.enabledModules : [];
  const slug = typeof body?.slug === 'string' ? body.slug : undefined;
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const tenant = await createTenant(name, plan, enabledModules, slug);
  auditFromSession(gate, await currentOrgId(), {
    action: 'tenant.change',
    resource: `tenant:${tenant.id ?? name}`,
    outcome: 'ok',
  });
  return NextResponse.json(tenant, { status: 201 });
}
