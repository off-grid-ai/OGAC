import { NextResponse } from 'next/server';
import { gateDeviceRequest } from '@/lib/device-auth';
import { takeCommands } from '@/lib/store';

// Node polls for pending commands (kill switch, re-provision). Returned commands are consumed.
// AUTH: per-device data-plane token — this GET *consumes* pending commands, so a spoofed id could
// drain another node's queue (incl. its kill command) without this gate (P1 — HARDENING_AUDIT.md).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await gateDeviceRequest(req, id);
  if (denied) return denied;
  return NextResponse.json({ object: 'list', data: await takeCommands(id) });
}
