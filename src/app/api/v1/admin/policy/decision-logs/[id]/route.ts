import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { deleteDecision, getDecision } from '@/lib/opa-decision-log-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// One decision's full record (input + result + reason + labels) — the list→detail leaf.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const { id } = await ctx.params;
  const decision = await getDecision(id, org);
  if (!decision) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(decision);
}

// Governed purge of one decision from the ledger (retention / erasure). Audited.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const org = await currentOrgId();
  const { id } = await ctx.params;
  const removed = await deleteDecision(id, org);
  if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  auditFromSession(gate, org, {
    action: 'policy.decision-log.delete',
    resource: `opa-decision:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ ok: true, deleted: id });
}
