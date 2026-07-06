import { NextResponse } from 'next/server';
import { getMdm } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { type FleetPolicyInput, validatePolicyInput } from '@/lib/fleetdm';

export const dynamic = 'force-dynamic';

function unsupported() {
  return NextResponse.json(
    { error: 'FleetDM policies require a FleetDM backend (set OFFGRID_ADAPTER_MDM=fleetdm)' },
    { status: 501 },
  );
}

// List FleetDM global policies (pass/fail posture across the fleet).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const mdm = getMdm();
  if (!mdm.supportsFleet || !mdm.listPolicies) return unsupported();
  try {
    return NextResponse.json({ policies: await mdm.listPolicies() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

// Create a FleetDM policy.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => ({}))) as Partial<FleetPolicyInput>;
  const check = validatePolicyInput(body);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  const mdm = getMdm();
  if (!mdm.supportsFleet || !mdm.createPolicy) return unsupported();
  try {
    const policy = await mdm.createPolicy(body as FleetPolicyInput);
    auditFromSession(gate, await currentOrgId(), {
      action: 'fleet.policy.change',
      resource: `fleet-policy:${(policy as { id?: unknown }).id ?? body.name ?? 'new'}`,
      outcome: 'ok',
    });
    return NextResponse.json(policy, { status: 201 });
  } catch (err) {
    auditFromSession(gate, await currentOrgId(), {
      action: 'fleet.policy.change',
      resource: `fleet-policy:${body.name ?? 'new'}`,
      outcome: 'error',
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
