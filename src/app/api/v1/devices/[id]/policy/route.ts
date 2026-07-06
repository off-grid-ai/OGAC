import { NextResponse } from 'next/server';
import { gateDeviceRequest } from '@/lib/device-auth';
import { pullPolicyForDevice } from '@/lib/store';

// Node pulls its current policy bundle (and reports in, converging to the org version).
// AUTH: same per-device data-plane token as /audit + /commands — otherwise a spoofed id could read
// another node's policy and force its status/lastSeen to update (P1 — HARDENING_AUDIT.md).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await gateDeviceRequest(req, id);
  if (denied) return denied;
  const policy = await pullPolicyForDevice(id);
  if (!policy) {
    return NextResponse.json({ error: 'unknown device' }, { status: 404 });
  }
  return NextResponse.json(policy);
}
