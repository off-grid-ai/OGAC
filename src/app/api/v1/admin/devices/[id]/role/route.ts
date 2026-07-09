import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { getDevice, updateDeviceRole } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Reassign a device's policy ROLE — the per-device dimension that selects which policy/routing
// applies (the policy bundle is org-wide; role is what varies per device). Admin-gated + audited.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;

  let body: { role?: unknown };
  try {
    body = (await req.json()) as { role?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const role = typeof body.role === 'string' ? body.role.trim() : '';
  if (role.length < 2 || role.length > 80) {
    return NextResponse.json(
      { error: 'role must be between 2 and 80 characters' },
      { status: 400 },
    );
  }

  // Tenant-scoped: the device must belong to the caller's org (cross-tenant IDOR — P0).
  const org = await currentOrgId();
  const before = await getDevice(id, org);
  if (!before) return NextResponse.json({ error: 'unknown device' }, { status: 404 });

  const updated = await updateDeviceRole(id, role, org);
  if (!updated) return NextResponse.json({ error: 'unknown device' }, { status: 404 });

  auditFromSession(gate, org, {
    action: 'device.role.reassign',
    resource: `device:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ device: updated, previousRole: before.role }, { status: 200 });
}
