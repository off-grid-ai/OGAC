import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { queueKill } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

// Admin triggers the kill switch for a device; the node executes it on next command poll.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  // Tenant-scoped kill: the device must belong to the caller's org, else queueKill returns null
  // (404) — an admin on tenant A can never kill tenant B's device by id (destructive IDOR — P0).
  const org = await currentOrgId();
  const cmd = await queueKill(id, org);
  if (!cmd) {
    return NextResponse.json({ error: 'unknown device' }, { status: 404 });
  }
  auditFromSession(gate, org, {
    action: 'device.kill',
    resource: `device:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(cmd, { status: 202 });
}
