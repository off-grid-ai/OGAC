import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { deleteTenant, setTenantModules } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';
import { mayManageTenant } from '@/lib/tenancy-policy';

// Both mutations below took `id` from the URL with NO org check at all — any caller who cleared
// requireAdmin could edit or delete ANOTHER tenant's row by guessing its id (the write side of the
// tenant-admin-list leak found live 2026-08-05). `mayManageTenant` is the same boundary
// `visibleTenants` applies on read: a platform operator (DEFAULT_ORG) manages every tenant, anyone
// else manages only their own. A mismatch returns the SAME 404 "unknown tenant" a truly-unknown id
// gets — never a 403, which would confirm the id belongs to someone else.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  if (!mayManageTenant(org, id)) {
    return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.enabledModules)) {
    return NextResponse.json({ error: 'enabledModules (array) required' }, { status: 400 });
  }
  const t = await setTenantModules(id, body.enabledModules);
  if (!t) {
    return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });
  }
  auditFromSession(gate, org, {
    action: 'tenant.change',
    resource: `tenant:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(t);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  if (!mayManageTenant(org, id)) {
    return NextResponse.json({ error: 'unknown tenant' }, { status: 404 });
  }
  await deleteTenant(id);
  auditFromSession(gate, org, {
    action: 'tenant.change',
    resource: `tenant:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
