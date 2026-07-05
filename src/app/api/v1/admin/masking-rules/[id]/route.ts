import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { setMaskingRuleEnabled } from '@/lib/store';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
  }
  await setMaskingRuleEnabled(id, body.enabled);
  auditFromSession(gate, await currentOrgId(), {
    action: 'masking.change',
    resource: `masking:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ id, enabled: body.enabled });
}
