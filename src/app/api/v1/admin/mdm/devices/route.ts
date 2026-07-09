import { NextResponse } from 'next/server';
import { getMdm } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Fleet Control device inventory through the active MDM adapter (OFFGRID_ADAPTER_MDM): the
// first-party device registry by default, or FleetDM (osquery) when selected. FleetDM falls back
// to the first-party registry if its server is unreachable. TENANT-SCOPED (SECURITY WAVE 1): the
// first-party registry is filtered to the caller's org (currentOrgId).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const mdm = getMdm();
  const devices = await mdm.listDevices(await currentOrgId());
  return NextResponse.json({ object: 'list', backend: mdm.meta.id, data: devices });
}
