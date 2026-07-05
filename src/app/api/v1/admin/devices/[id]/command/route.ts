import { NextResponse } from 'next/server';
import { getMdm } from '@/lib/adapters/registry';
import { requireAdmin } from '@/lib/authz';
import type { DeviceCommand } from '@/lib/fleetdm';
import { queueKill } from '@/lib/store';

export const dynamic = 'force-dynamic';

const COMMANDS: DeviceCommand[] = ['lock', 'unlock', 'wipe', 'refetch'];

// Destructive device commands routed through the active MDM adapter. When FleetDM is active
// (supportsFleet) the command hits FleetDM's real MDM command endpoints (lock/unlock/wipe/refetch)
// by numeric host id. Otherwise we preserve today's first-party behavior: lock/wipe queue the
// kill-switch command the enrolled node executes on its next poll (byte-identical to the /kill
// route); unlock/refetch have no first-party analogue and are reported unsupported.
//
// Admin-gated (requireAdmin); the UI confirms before calling (delete-confirm style).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;

  let body: { command?: string };
  try {
    body = (await req.json()) as { command?: string };
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const command = body.command as DeviceCommand | undefined;
  if (!command || !COMMANDS.includes(command)) {
    return NextResponse.json(
      { error: `command must be one of: ${COMMANDS.join(', ')}` },
      { status: 400 },
    );
  }

  const mdm = getMdm();

  // ── FleetDM path: real MDM command endpoints ──────────────────────────────────
  if (mdm.supportsFleet) {
    const hostId = Number(id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      return NextResponse.json({ error: 'invalid host id' }, { status: 400 });
    }
    const fn = {
      lock: mdm.lockHost,
      unlock: mdm.unlockHost,
      wipe: mdm.wipeHost,
      refetch: mdm.refetchHost,
    }[command];
    if (!fn) {
      return NextResponse.json(
        { error: `${command} not supported by the active MDM backend` },
        { status: 501 },
      );
    }
    try {
      const result = await fn.call(mdm, hostId);
      return NextResponse.json({ backend: mdm.meta.id, ...result }, { status: 202 });
    } catch (err) {
      return NextResponse.json(
        { error: `${command} failed: ${(err as Error).message}` },
        { status: 502 },
      );
    }
  }

  // ── First-party fallback: the in-console device registry ──────────────────────
  // Only the destructive lock/wipe map to the existing kill switch; unlock/refetch have no
  // first-party equivalent (there is no osquery agent to re-collect or an OS lock to reverse).
  if (command === 'lock' || command === 'wipe') {
    const cmd = await queueKill(id);
    if (!cmd) return NextResponse.json({ error: 'unknown device' }, { status: 404 });
    return NextResponse.json({ backend: mdm.meta.id, command, queued: cmd }, { status: 202 });
  }
  return NextResponse.json(
    { error: `${command} requires a FleetDM backend (set OFFGRID_ADAPTER_MDM=fleetdm)` },
    { status: 501 },
  );
}
