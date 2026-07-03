import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { createRule, listRules, validateRule } from '@/lib/analytics-rules';

export const dynamic = 'force-dynamic';

// Analytics alert rules — console-owned entities over the read-only charts.
// GET (admin) → list rules. POST (admin) → create a validated rule.
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listRules() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const raw = await req.json().catch(() => null);
  const v = validateRule(raw);
  if (!v.valid || !v.value) return NextResponse.json({ error: v.errors.join('; ') }, { status: 400 });
  const rule = await createRule(v.value, gate.user.email ?? '');
  return NextResponse.json(rule, { status: 201 });
}
