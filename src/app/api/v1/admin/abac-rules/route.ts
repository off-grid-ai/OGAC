import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
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
  return NextResponse.json({ object: 'list', data: await listAbacRules() });
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
  return NextResponse.json(
    await createAbacRule({
      role: (b!.role as string | undefined) ?? '*',
      resource: (b!.resource as string | undefined) ?? '*',
      attribute: b!.attribute as string,
      operator: b!.operator as string,
      value: b!.value as string,
      effect: b!.effect as string,
    }),
    { status: 201 },
  );
}
