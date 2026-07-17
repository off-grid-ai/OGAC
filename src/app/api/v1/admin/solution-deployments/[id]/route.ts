import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import type { SolutionDeploymentInput } from '@/lib/solution-blueprints';
import {
  deleteSolutionDeployment,
  getSolutionDeployment,
  updateSolutionDeployment,
} from '@/lib/solution-blueprints-store';
import { solutionErrorResponse } from '@/lib/solution-http';
import { currentOrgId } from '@/lib/tenancy';

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const deployment = await getSolutionDeployment((await params).id, await currentOrgId());
  return deployment
    ? NextResponse.json(deployment)
    : NextResponse.json({ error: 'unknown deployment' }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'a JSON patch is required' }, { status: 400 });
  const { id } = await params;
  const orgId = await currentOrgId();
  const patch: Partial<Pick<SolutionDeploymentInput, 'status'>> = {};
  if (body.status === 'active' || body.status === 'paused' || body.status === 'retired') {
    patch.status = body.status;
  }
  try {
    const updated = await updateSolutionDeployment(id, orgId, patch);
    if (!updated) return NextResponse.json({ error: 'unknown deployment' }, { status: 404 });
    auditFromSession(gate, orgId, {
      action: 'solution-deployment.update',
      resource: `solution-deployment:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json(updated);
  } catch (error) {
    const response = solutionErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  if (!(await deleteSolutionDeployment(id, orgId)))
    return NextResponse.json({ error: 'unknown deployment' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'solution-deployment.retire',
    resource: `solution-deployment:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ retired: true });
}
