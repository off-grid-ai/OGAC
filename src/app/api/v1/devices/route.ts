import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/authz';
import { listDevices } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Headless fleet API — the "just the API" contract; the Fleet UI is one consumer of it. GATED +
// TENANT-SCOPED (SECURITY WAVE 1): was ungated AND unscoped, so any user read the WHOLE fleet across
// tenants (P0). Now requires an authenticated principal and returns only the caller's org's devices.
export async function GET(req: Request) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listDevices(await currentOrgId()) });
}
