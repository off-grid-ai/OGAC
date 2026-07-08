import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { RETENTION_ACTIONS } from '@/lib/data-retention';
import { deleteRetention, getAsset, getRetention, setRetention } from '@/lib/data-catalog-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Per-asset retention policy (M4). GET → the policy (or null). PUT → upsert. DELETE → remove.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  const asset = await getAsset(id, org);
  if (!asset) return NextResponse.json({ error: 'unknown data asset' }, { status: 404 });
  return NextResponse.json({ data: await getRetention(id, org) });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  const asset = await getAsset(id, org);
  if (!asset) return NextResponse.json({ error: 'unknown data asset' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const retainDays = Number(body?.retainDays);
  if (!Number.isFinite(retainDays) || retainDays < 0) {
    return NextResponse.json({ error: 'retainDays must be a non-negative number' }, { status: 400 });
  }
  const action = String(body?.action ?? 'delete');
  if (!(RETENTION_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json(
      { error: `action must be one of ${RETENTION_ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }
  const row = await setRetention(
    id,
    { retainDays: Math.floor(retainDays), action, legalHold: !!body?.legalHold, note: String(body?.note ?? '') },
    org,
  );
  auditFromSession(gate, org, {
    action: 'retention-policy.set',
    resource: `data-asset:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(row);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  const ok = await deleteRetention(id, org);
  if (!ok) return NextResponse.json({ error: 'no retention policy set' }, { status: 404 });
  auditFromSession(gate, org, {
    action: 'retention-policy.delete',
    resource: `data-asset:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true });
}
