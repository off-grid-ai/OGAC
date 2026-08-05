import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { createTenant, listTenants } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { DEFAULT_ORG, visibleTenants } from '@/lib/tenancy-policy';

// The same API this UI's admin destination reads (see AdminDestination.tsx) — a stranger on either
// demo tenant's public link could curl this directly and read the WHOLE platform directory (every
// tenant's name/host/plan), because this route had no org awareness at all (leak found live
// 2026-08-05). Scoped the same way: a platform operator (DEFAULT_ORG) sees every tenant, anyone else
// sees only their own.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const tenants = visibleTenants(await listTenants(), await currentOrgId());
  return NextResponse.json({ object: 'list', data: tenants });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Provisioning a BRAND NEW tenant is a platform-level action — there is no "own tenant" for a
  // caller who isn't the platform operator to create, so this is gated on DEFAULT_ORG directly
  // (mayManageTenant has no meaning for a target that doesn't exist yet).
  const org = await currentOrgId();
  if (org !== DEFAULT_ORG) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const name = body?.name as string | undefined;
  const plan = (body?.plan as string | undefined) ?? 'standard';
  const enabledModules = Array.isArray(body?.enabledModules) ? body.enabledModules : [];
  const slug = typeof body?.slug === 'string' ? body.slug : undefined;
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  const tenant = await createTenant(name, plan, enabledModules, slug);
  auditFromSession(gate, org, {
    action: 'tenant.change',
    resource: `tenant:${tenant.id ?? name}`,
    outcome: 'ok',
  });
  return NextResponse.json(tenant, { status: 201 });
}
