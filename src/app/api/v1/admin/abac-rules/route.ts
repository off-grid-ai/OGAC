import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { createAbacRule, listAbacRules } from '@/lib/store';

const OPS = ['eq', 'neq', 'in'];
const EFFECTS = ['allow', 'deny'];

function validRule(b: Record<string, unknown> | null): boolean {
  if (!b) return false;
  const { attribute, value, operator, effect } = b;
  const opOk = typeof operator === 'string' && OPS.includes(operator);
  const efOk = typeof effect === 'string' && EFFECTS.includes(effect);
  return Boolean(attribute) && Boolean(value) && opOk && efOk;
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Tenant-scoped (SECURITY WAVE 1): only the caller's org rules.
  return NextResponse.json({ object: 'list', data: await listAbacRules(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!validRule(b)) {
    return NextResponse.json(
      { error: 'attribute, value, operator (eq|neq|in), effect (allow|deny) required' },
      { status: 400 },
    );
  }
  const org = await currentOrgId();
  const created = await createAbacRule(
    {
      role: (b!.role as string | undefined) ?? '*',
      resource: (b!.resource as string | undefined) ?? '*',
      attribute: b!.attribute as string,
      operator: b!.operator as string,
      value: b!.value as string,
      effect: b!.effect as string,
    },
    org,
  );
  auditFromSession(gate, org, {
    action: 'abac.change',
    resource: `abac:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
