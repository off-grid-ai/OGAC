import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { addEvalDef, listEvalDefs } from '@/lib/eval-defs';
import { validateEvalDef } from '@/lib/eval-defs-policy';

export const dynamic = 'force-dynamic';

// Eval definitions — first-class saved evaluators (a template applied, or authored from scratch).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Association filter — the corrected pipeline_id takes precedence over the legacy app_id.
  //   ?pipelineId=<id> → that pipeline's evals · ?pipelineId=none → org-wide library (unattached).
  //   ?appId=<id>      → that app's evals (legacy) · ?appId=none → org-wide library · omitted → all.
  const sp = new URL(req.url).searchParams;
  const pipeRaw = sp.get('pipelineId');
  const appRaw = sp.get('appId');
  const filter =
    pipeRaw !== null
      ? { pipelineId: pipeRaw === 'none' ? null : pipeRaw }
      : appRaw !== null
        ? { appId: appRaw === 'none' ? null : appRaw }
        : {};
  return NextResponse.json({ object: 'list', data: await listEvalDefs(filter) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const v = validateEvalDef(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  // Optional pipelineId/appId in the body attaches the eval (else it's an org-wide library eval).
  const appId = typeof body?.appId === 'string' ? body.appId : null;
  const pipelineId = typeof body?.pipelineId === 'string' ? body.pipelineId : null;
  return NextResponse.json(await addEvalDef(v.value, '', { appId, pipelineId }), { status: 201 });
}
