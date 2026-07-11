import { NextResponse } from 'next/server';
import { getMdm } from '@/lib/adapters/registry';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { type FleetPolicyInput, validatePolicyInput } from '@/lib/fleetdm';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

function unsupported() {
  return NextResponse.json(
    { error: 'FleetDM policies require a FleetDM backend (set OFFGRID_ADAPTER_MDM=fleetdm)' },
    { status: 501 },
  );
}

// Edit a FleetDM policy.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const policyId = Number(id);
  if (!Number.isInteger(policyId) || policyId <= 0) {
    return NextResponse.json({ error: 'invalid policy id' }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<FleetPolicyInput>;
  // A PATCH may touch only some fields, but if name/query are present they must be valid.
  if (body.name !== undefined || body.query !== undefined) {
    const check = validatePolicyInput({
      name: body.name ?? 'x',
      query: body.query ?? 'SELECT 1',
      ...body,
    });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  }
  const mdm = getMdm();
  if (!mdm.supportsFleet || !mdm.updatePolicy) return unsupported();
  try {
    const updated = await mdm.updatePolicy(policyId, body);
    auditFromSession(gate, await currentOrgId(), {
      action: 'fleet.policy.change',
      resource: `fleet-policy:${policyId}`,
      outcome: 'ok',
    });
    return NextResponse.json(updated);
  } catch (err) {
    auditFromSession(gate, await currentOrgId(), {
      action: 'fleet.policy.change',
      resource: `fleet-policy:${policyId}`,
      outcome: 'error',
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

// Delete a FleetDM policy.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const policyId = Number(id);
  if (!Number.isInteger(policyId) || policyId <= 0) {
    return NextResponse.json({ error: 'invalid policy id' }, { status: 400 });
  }
  const mdm = getMdm();
  if (!mdm.supportsFleet || !mdm.deletePolicy) return unsupported();
  try {
    await mdm.deletePolicy(policyId);
    auditFromSession(gate, await currentOrgId(), {
      action: 'fleet.policy.change',
      resource: `fleet-policy:${policyId}`,
      outcome: 'ok',
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    auditFromSession(gate, await currentOrgId(), {
      action: 'fleet.policy.change',
      resource: `fleet-policy:${policyId}`,
      outcome: 'error',
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
