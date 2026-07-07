import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { addEvalDef, listEvalDefs } from '@/lib/eval-defs';
import { validateEvalDef } from '@/lib/eval-defs-policy';

export const dynamic = 'force-dynamic';

// Eval definitions — first-class saved evaluators (a template applied, or authored from scratch).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // ?appId=<id> → that pipeline's evals · ?appId=none → org-wide library evals · omitted → all.
  const raw = new URL(req.url).searchParams.get('appId');
  const appId = raw === null ? undefined : raw === 'none' ? null : raw;
  return NextResponse.json({ object: 'list', data: await listEvalDefs(appId) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const v = validateEvalDef(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  // Optional appId in the body attaches the eval to a pipeline (else it's an org-wide library eval).
  const appId = typeof body?.appId === 'string' ? body.appId : null;
  return NextResponse.json(await addEvalDef(v.value, '', appId), { status: 201 });
}
