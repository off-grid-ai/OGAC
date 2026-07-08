import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import {
  acknowledgeTombstone,
  countPendingTombstones,
  listTombstones,
} from '@/lib/erasure-tombstone-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// DSAR device-replica tombstone QUEUE. Device replicas can't be reached synchronously, so a subject
// erasure records a durable "forget subject X" tombstone here (via propagateErasure). Devices poll
// this queue and PATCH a tombstone to acknowledged once they've applied the erasure on-device.
//
// GET  ?pending=1 → the tombstones for the org (pending-only when flagged) + a pending count.
// PATCH { id }    → mark a tombstone acknowledged (a device applied it).

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const onlyPending = new URL(req.url).searchParams.get('pending') === '1';
  const [data, pending] = await Promise.all([
    listTombstones(org, onlyPending),
    countPendingTombstones(org),
  ]);
  return NextResponse.json({ object: 'list', data, pending });
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = String(body?.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updated = await acknowledgeTombstone(id, org);
  if (!updated) return NextResponse.json({ error: 'tombstone not found' }, { status: 404 });

  auditFromSession(gate, org, {
    action: 'data.erasure-tombstone.ack',
    resource: `tombstone:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ tombstone: updated });
}
