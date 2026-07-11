import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { setMaskingRuleEnabled } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
  }
  // Scope the toggle to the caller's org — org A cannot flip org B's masking rule (P1 IDOR fix).
  const orgId = await currentOrgId();
  await setMaskingRuleEnabled(id, body.enabled, orgId);
  auditFromSession(gate, orgId, {
    action: 'masking.change',
    resource: `masking:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ id, enabled: body.enabled });
}
