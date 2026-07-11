import { NextResponse } from 'next/server';
import { getMdm } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';

export const dynamic = 'force-dynamic';

// Per-host installed software + known CVEs from the active MDM (FleetDM).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const hostId = Number(id);
  if (!Number.isInteger(hostId) || hostId <= 0) {
    return NextResponse.json({ error: 'invalid host id' }, { status: 400 });
  }

  const mdm = getMdm();
  if (!mdm.supportsFleet || !mdm.hostSoftware) {
    return NextResponse.json(
      { error: 'Software inventory requires a FleetDM backend — connect one in Settings.' },
      { status: 501 },
    );
  }
  try {
    return NextResponse.json(await mdm.hostSoftware(hostId));
  } catch (err) {
    return NextResponse.json(
      { error: `software lookup failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
