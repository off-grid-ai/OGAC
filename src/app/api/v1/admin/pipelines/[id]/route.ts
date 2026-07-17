import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { getPipeline, updatePipeline } from '@/lib/pipelines';
import { deleteUnusedPipeline } from '@/lib/pipeline-retirement';
import {
  normalizeAllowlist,
  normalizeRouting,
  validatePipelineUpdate,
} from '@/lib/pipelines-policy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// One pipeline: read, update (bumps version + writes a snapshot), or delete. Admin-gated, org-scoped,
// audited.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const p = await getPipeline(id, orgId);
  if (!p) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });
  return NextResponse.json(p);
}

// Pure: build the partial pipeline-update patch from the (already-validated) request body. Each
// field is coerced only when present; behavior-identical to the previous inline construction.
function buildPipelinePatch(
  body: Record<string, unknown> | null,
): Parameters<typeof updatePipeline>[1] {
  const patch: Parameters<typeof updatePipeline>[1] = {};
  if (body?.name !== undefined) patch.name = String(body.name).trim();
  if (body?.description !== undefined) patch.description = String(body.description);
  if (body?.visibility !== undefined) patch.visibility = String(body.visibility);
  if (body && 'gatewayId' in body) patch.gatewayId = body.gatewayId ? String(body.gatewayId) : null;
  if (body && 'defaultModel' in body)
    patch.defaultModel = body.defaultModel ? String(body.defaultModel) : null;
  if (body?.routing !== undefined) patch.routing = normalizeRouting(body.routing);
  if (body?.dataAllowlist !== undefined)
    patch.dataAllowlist = normalizeAllowlist(body.dataAllowlist);
  if (body?.policyOverlay !== undefined)
    patch.policyOverlay = body.policyOverlay as Record<string, unknown>;
  if (body?.guardrailOverlay !== undefined)
    patch.guardrailOverlay = body.guardrailOverlay as Record<string, unknown>;
  if (body?.status !== undefined) patch.status = String(body.status);
  if (body?.isTemplate !== undefined) patch.isTemplate = Boolean(body.isTemplate);
  return patch;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const check = validatePipelineUpdate({
    name: body?.name,
    visibility: body?.visibility,
    status: body?.status,
  });
  if (!check.ok) {
    return NextResponse.json(
      { error: check.errors.join('; '), errors: check.errors },
      { status: 400 },
    );
  }

  const patch = buildPipelinePatch(body);

  const orgId = await currentOrgId();
  const editedBy = gate.user.email ?? 'service@offgrid.local';
  const updated = await updatePipeline(id, patch, orgId, editedBy);
  if (!updated) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'pipeline.update',
    resource: `pipeline:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const result = await deleteUnusedPipeline(id, orgId);
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });
    }
    return NextResponse.json(
      {
        error: 'pipeline is still in use',
        reason: 'Rebind or remove every consumer before deleting this pipeline.',
        consumers: result.consumers,
      },
      { status: 409 },
    );
  }
  auditFromSession(gate, orgId, {
    action: 'pipeline.delete',
    resource: `pipeline:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
