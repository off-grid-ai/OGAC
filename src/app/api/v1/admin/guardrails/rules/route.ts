import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { createGuardrailRule, listGuardrailRules, validateRule } from '@/lib/guardrails-rules';
import { currentOrgId } from '@/lib/tenancy';

// Guardrails masking-rules collection. GET lists the org's rules; POST creates one after pure
// validation (entity|regex matcher → redact|mask|hash|allow|block|flag|log action). Thin:
// admin-gated, validate, delegate to the lib.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listGuardrailRules(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const parsed = validateRule(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const orgId = await currentOrgId();
  const created = await createGuardrailRule(parsed.value, orgId);
  auditFromSession(gate, orgId, {
    action: 'guardrail.change',
    resource: `guardrail:${(created as { id?: string }).id ?? 'rule'}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
