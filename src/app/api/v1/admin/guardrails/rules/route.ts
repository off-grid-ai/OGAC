import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createGuardrailRule, listGuardrailRules, validateRule } from '@/lib/guardrails-rules';
import { currentOrgId } from '@/lib/tenancy';

// Guardrails masking-rules collection. GET lists the org's rules; POST creates one after pure
// validation (entity|regex matcher → redact|mask|hash|allow action). Thin: admin-gated, validate,
// delegate to the lib.

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
  return NextResponse.json(await createGuardrailRule(parsed.value, await currentOrgId()), {
    status: 201,
  });
}
