import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createMaskingRule, listMaskingRules } from '@/lib/store';

const ACTIONS = ['mask', 'tokenize', 'block'];

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listMaskingRules() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const kind = body?.kind as string | undefined;
  const action = body?.action as string | undefined;
  if (!kind || !action || !ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: 'kind and action (mask|tokenize|block) required' },
      { status: 400 },
    );
  }
  return NextResponse.json(await createMaskingRule(kind, action), { status: 201 });
}
