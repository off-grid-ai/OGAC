import { NextResponse } from 'next/server';
import { type AuditEvent, appendAudit, getDevice } from '@/lib/store';

type IncomingEvent = Omit<AuditEvent, 'id' | 'deviceId'>;

// Node pushes a batch of audit events up to the console (what it ran, what left the device).
// AUTH: the node must present its device token (issued at enrollment as `dt_<id>`) as a Bearer,
// scoped to THIS device id — otherwise any anonymous caller could poison the audit log for any
// device. (P0 — HARDENING_AUDIT.md.) The device data-plane is public in middleware precisely
// because it authenticates with this device token here, not user SSO.
// NOTE (follow-up P1): the `dt_<id>` token is predictable; enrollment should issue a random
// per-device secret stored server-side — logged in the hardening backlog.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (bearer !== `dt_${id}`) {
    return NextResponse.json({ error: 'invalid device token' }, { status: 401 });
  }
  if (!(await getDevice(id))) {
    return NextResponse.json({ error: 'unknown device' }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const events: IncomingEvent[] = Array.isArray(body?.events) ? body.events : [];
  const accepted = await appendAudit(id, events);
  return NextResponse.json({ accepted }, { status: 202 });
}
