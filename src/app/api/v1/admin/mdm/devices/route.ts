import { NextResponse } from 'next/server';
import { getMdm } from '@/lib/adapters/registry';

// Fleet Control device inventory through the active MDM adapter (OFFGRID_ADAPTER_MDM): the
// first-party device registry by default, or FleetDM (osquery) when selected. FleetDM falls back
// to the first-party registry if its server is unreachable.
export async function GET() {
  const mdm = getMdm();
  const devices = await mdm.listDevices();
  return NextResponse.json({ object: 'list', backend: mdm.meta.id, data: devices });
}
