import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { addGoldenCase, listGoldenCases } from '@/lib/evals';
import { validateGoldenCase } from '@/lib/evals-golden';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  // Association filter — the corrected pipeline_id takes precedence over the legacy app_id.
  //   ?pipelineId=<id> → that pipeline's golden set · ?pipelineId=none → org-wide library.
  //   ?appId=<id>      → that app's golden set (legacy) · ?appId=none → library · omitted → all.
  const sp = new URL(req.url).searchParams;
  const pipeRaw = sp.get('pipelineId');
  const appRaw = sp.get('appId');
  const filter =
    pipeRaw !== null
      ? { pipelineId: pipeRaw === 'none' ? null : pipeRaw }
      : appRaw !== null
        ? { appId: appRaw === 'none' ? null : appRaw }
        : {};
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
  return NextResponse.json(await addGoldenCase(v.value, { appId, pipelineId }), { status: 201 });
}
