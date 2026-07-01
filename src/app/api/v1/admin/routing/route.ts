import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createRoutingRule, listRoutingRules } from '@/lib/store';

const OPS = ['eq', 'neq', 'in'];
const ACTIONS = ['local', 'cloud', 'block'];

function valid(b: Record<string, unknown> | null): boolean {
  if (!b) return false;
  const opOk = typeof b.operator === 'string' && OPS.includes(b.operator);
  const actOk = typeof b.action === 'string' && ACTIONS.includes(b.action);
  return Boolean(b.name) && Boolean(b.attribute) && Boolean(b.value) && opOk && actOk;
}

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listRoutingRules() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!valid(b)) {
    return NextResponse.json(
      {
        error: 'name, attribute, value, operator (eq|neq|in), action (local|cloud|block) required',
      },
      { status: 400 },
    );
  }
  return NextResponse.json(
    await createRoutingRule({
      name: b!.name as string,
      priority: typeof b!.priority === 'number' ? (b!.priority as number) : 100,
      attribute: b!.attribute as string,
      operator: b!.operator as string,
      value: b!.value as string,
      action: b!.action as string,
      model: (b!.model as string | undefined) ?? '',
      fallback: (b!.fallback as string | undefined) ?? '',
    }),
    { status: 201 },
  );
}
