import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { addEvalDef, listEvalDefs } from '@/lib/eval-defs';
import { validateEvalDef } from '@/lib/eval-defs-policy';

export const dynamic = 'force-dynamic';

// Eval definitions — first-class saved evaluators (a template applied, or authored from scratch).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listEvalDefs() });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const v = validateEvalDef(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  return NextResponse.json(await addEvalDef(v.value), { status: 201 });
}
