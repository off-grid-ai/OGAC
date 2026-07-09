import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { addGoldenCase, listGoldenCases } from '@/lib/evals';
import { validateGoldenCase } from '@/lib/evals-golden';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Association filter — the corrected pipeline_id takes precedence over the legacy app_id.
  //   ?pipelineId=<id> → that pipeline's golden set · ?pipelineId=none → org-wide library.
  //   ?appId=<id>      → that app's golden set (legacy) · ?appId=none → library · omitted → all.
  // Always scoped to the caller's org so one tenant never lists another tenant's cases.
  const orgId = await currentOrgId();
  const sp = new URL(req.url).searchParams;
  const pipeRaw = sp.get('pipelineId');
  const appRaw = sp.get('appId');
  const filter =
    pipeRaw !== null
      ? { orgId, pipelineId: pipeRaw === 'none' ? null : pipeRaw }
      : appRaw !== null
        ? { orgId, appId: appRaw === 'none' ? null : appRaw }
        : { orgId };
  return NextResponse.json({ object: 'list', data: await listGoldenCases(filter) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => null);
  const v = validateGoldenCase(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  // Optional pipelineId/appId attaches this golden case (else it's an org-wide library case).
  const appId = typeof body?.appId === 'string' ? body.appId : null;
  const pipelineId = typeof body?.pipelineId === 'string' ? body.pipelineId : null;
  const orgId = await currentOrgId();
  return NextResponse.json(await addGoldenCase(v.value, { appId, pipelineId, orgId }), {
    status: 201,
  });
}
