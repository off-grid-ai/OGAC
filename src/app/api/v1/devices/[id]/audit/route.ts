import { NextResponse } from 'next/server';
import { gateDeviceRequest } from '@/lib/device-auth';
import { type AuditEvent, appendAudit } from '@/lib/store';

type IncomingEvent = Omit<AuditEvent, 'id' | 'deviceId'>;

// Node pushes a batch of audit events up to the console (what it ran, what left the device).
// AUTH: the node must present its per-device data-plane token (a RANDOM secret minted at enrollment,
// stored on the device row) as a Bearer — otherwise any anonymous caller could poison the audit log
// for any device. (P0 — HARDENING_AUDIT.md.) The device data-plane is public in middleware precisely
// because it authenticates with this device token here, not user SSO. Token verify + device-exists
// live in the shared gateDeviceRequest() seam (pure rules in src/lib/device-token.ts).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await gateDeviceRequest(req, id);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const events: IncomingEvent[] = Array.isArray(body?.events) ? body.events : [];
  const accepted = await appendAudit(id, events);
  return NextResponse.json({ accepted }, { status: 202 });
}
