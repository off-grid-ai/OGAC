import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { addEvalDef, listEvalDefs } from '@/lib/eval-defs';
import { validateEvalDef } from '@/lib/eval-defs-policy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Eval definitions — first-class saved evaluators (a template applied, or authored from scratch).
export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Association filter — the corrected pipeline_id takes precedence over the legacy app_id.
  //   ?pipelineId=<id> → that pipeline's evals · ?pipelineId=none → org-wide library (unattached).
  //   ?appId=<id>      → that app's evals (legacy) · ?appId=none → org-wide library · omitted → all.
  // Always scoped to the caller's org so one tenant never lists another tenant's evals.
  const orgId = await currentOrgId();
  const sp = new URL(req.url).searchParams;
  const pipeRaw = sp.get('pipelineId');
  const appRaw = sp.get('appId');
  let filter: { orgId: string; pipelineId?: string | null; appId?: string | null } = { orgId };
  if (pipeRaw !== null) {
    filter = { orgId, pipelineId: pipeRaw === 'none' ? null : pipeRaw };
  } else if (appRaw !== null) {
    filter = { orgId, appId: appRaw === 'none' ? null : appRaw };
  }
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
  const orgId = await currentOrgId();
  return NextResponse.json(await addEvalDef(v.value, '', { appId, pipelineId, orgId }), {
    status: 201,
  });
}
