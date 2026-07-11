import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { createPipeline, listPipelines } from '@/lib/pipelines';
import { normalizeAllowlist, normalizeRouting, validatePipelineCreate } from '@/lib/pipelines-policy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Pipeline collection (Gateways × Pipelines, the PIPELINE tier) ────────────────────────────────
// The reusable, GOVERNED model-access contract. Admin-gated, org-scoped, audited. Pure validation +
// normalisation live in pipelines-policy.ts; persistence + version snapshots in pipelines.ts.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({ object: 'list', data: await listPipelines(orgId) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const check = validatePipelineCreate({
    name: body?.name,
    description: body?.description,
    visibility: body?.visibility,
    status: body?.status,
    isTemplate: body?.isTemplate,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.errors.join('; '), errors: check.errors }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const ownerId = gate.user.email ?? 'service@offgrid.local';
  const created = await createPipeline(
    {
      name: String(body?.name ?? '').trim(),
      description: typeof body?.description === 'string' ? body.description : '',
      visibility: typeof body?.visibility === 'string' ? body.visibility : 'private',
      gatewayId: typeof body?.gatewayId === 'string' && body.gatewayId ? body.gatewayId : null,
      defaultModel: typeof body?.defaultModel === 'string' && body.defaultModel ? body.defaultModel : null,
      routing: normalizeRouting(body?.routing),
      dataAllowlist: normalizeAllowlist(body?.dataAllowlist),
      policyOverlay: (body?.policyOverlay as Record<string, unknown>) ?? {},
      guardrailOverlay: (body?.guardrailOverlay as Record<string, unknown>) ?? {},
      status: typeof body?.status === 'string' ? body.status : 'draft',
      isTemplate: Boolean(body?.isTemplate),
    },
    ownerId,
    orgId,
  );
  auditFromSession(gate, orgId, {
    action: 'pipeline.create',
    resource: `pipeline:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
