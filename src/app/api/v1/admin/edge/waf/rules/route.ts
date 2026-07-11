import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { upsertRule, validateRule } from '@/lib/edge-intent';
import { getEdgeIntent, saveEdgeIntent } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Create OR update a custom WAF rule (upsert by id — POST with an existing id edits it). Persists
// the INTENT (applies on next edge reload). Admin-gated + audited.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: { id?: string; name?: string; pattern?: string; enabled?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const valid = validateRule(body);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

  const current = await getEdgeIntent();
  const existed = current.rules.some((r) => r.id === valid.rule.id);
  const next = upsertRule(current, valid.rule);
  const saved = await saveEdgeIntent(next);

  auditFromSession(gate, await currentOrgId(), {
    action: existed ? 'edge.waf.rule.update' : 'edge.waf.rule.create',
    resource: `edge:waf:rule:${valid.rule.id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ intent: saved, rule: valid.rule }, { status: existed ? 200 : 201 });
}
