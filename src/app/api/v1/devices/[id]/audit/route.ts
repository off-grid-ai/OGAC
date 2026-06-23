import { NextResponse } from 'next/server';
import { type AuditEvent, appendAudit, getDevice } from '@/lib/store';

type IncomingEvent = Omit<AuditEvent, 'id' | 'deviceId'>;

// Node pushes a batch of audit events up to the console (what it ran, what left the device).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getDevice(id))) {
    return NextResponse.json({ error: 'unknown device' }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const events: IncomingEvent[] = Array.isArray(body?.events) ? body.events : [];
  const accepted = await appendAudit(id, events);
  return NextResponse.json({ accepted }, { status: 202 });
}
