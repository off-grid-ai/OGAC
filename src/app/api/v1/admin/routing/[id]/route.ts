import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { deleteRoutingRule, setRoutingRuleEnabled } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (!b || typeof b.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
  }
  const orgP = await currentOrgId();
  await setRoutingRuleEnabled(id, b.enabled, orgP);
  auditFromSession(gate, orgP, {
    action: 'routing.change',
    resource: `routing:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const org = await currentOrgId();
  await deleteRoutingRule(id, org);
  auditFromSession(gate, org, {
    action: 'routing.change',
    resource: `routing:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true });
}
