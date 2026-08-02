import { NextResponse } from 'next/server';
import { listApps } from '@/lib/apps-store';
import { requireAdmin } from '@/lib/authz';
import { ownersForCase } from '@/lib/golden-case-owners';
import { listPipelines } from '@/lib/pipelines';
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
  let filter: { orgId: string; pipelineId?: string | null; appId?: string | null } = { orgId };
  if (pipeRaw !== null) {
    filter = { orgId, pipelineId: pipeRaw === 'none' ? null : pipeRaw };
  } else if (appRaw !== null) {
    filter = { orgId, appId: appRaw === 'none' ? null : appRaw };
  }
  const cases = await listGoldenCases(filter);
  // WHICH APPS EACH CASE MEASURES. Founder, live: "quality needs to be more tightly coupled to apps,
  // else what's the point — right now it seems standalone." The list showed a raw suite chip
  // (`pipeline:pl_seed_org_bharat_kyc-verification`) and never named an app, so a reader could not
  // answer the only question that matters about a check: what breaks if it fails. A case reaches an
  // app directly (app_id) or THROUGH its pipeline — the second is the common case and was invisible.
  const [apps, pipelines] = await Promise.all([
    listApps(orgId).catch(() => []),
    listPipelines(orgId).catch(() => []),
  ]);
  const pipelineNames = new Map(pipelines.map((p) => [p.id, p.name]));
  const appLikes = apps.map((a) => ({ id: a.id, title: a.title, pipelineId: a.pipelineId ?? null }));
  return NextResponse.json({
    object: 'list',
    data: cases.map((c) => ({ ...c, owners: ownersForCase(c, appLikes, pipelineNames) })),
  });
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
