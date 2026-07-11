import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { removeRule } from '@/lib/edge-intent';
import { getEdgeIntent, saveEdgeIntent } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Delete a custom WAF rule by id. Persists the INTENT (applies on next edge reload). Admin-gated
// + audited. 404 when the rule id isn't in the current intent.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;

  const current = await getEdgeIntent();
  const { intent, changed } = removeRule(current, id);
  if (!changed) return NextResponse.json({ error: 'unknown rule' }, { status: 404 });

  const saved = await saveEdgeIntent(intent);
  auditFromSession(gate, await currentOrgId(), {
    action: 'edge.waf.rule.delete',
    resource: `edge:waf:rule:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(saved, { status: 200 });
}
