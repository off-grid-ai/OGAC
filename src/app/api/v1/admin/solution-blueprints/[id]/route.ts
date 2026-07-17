import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { parseBlueprintPatch } from '@/lib/solution-blueprint-request';
import {
  deleteSolutionBlueprint,
  getSolutionBlueprint,
  SolutionValidationError,
  updateSolutionBlueprint,
} from '@/lib/solution-blueprints-store';
import { currentOrgId } from '@/lib/tenancy';

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const blueprint = await getSolutionBlueprint((await params).id, await currentOrgId());
  return blueprint
    ? NextResponse.json(blueprint)
    : NextResponse.json({ error: 'unknown blueprint' }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const patch = parseBlueprintPatch(await req.json().catch(() => null));
  if (!patch) return NextResponse.json({ error: 'a JSON patch is required' }, { status: 400 });
  const { id } = await params;
  const orgId = await currentOrgId();
  try {
    const updated = await updateSolutionBlueprint(id, orgId, patch);
    if (!updated) return NextResponse.json({ error: 'unknown blueprint' }, { status: 404 });
    auditFromSession(gate, orgId, {
      action: 'solution-blueprint.update',
      resource: `solution-blueprint:${id}`,
      outcome: 'ok',
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof SolutionValidationError)
      return NextResponse.json(
        { error: 'invalid blueprint', errors: error.errors },
        { status: 422 },
      );
    throw error;
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  if (!(await deleteSolutionBlueprint(id, orgId)))
    return NextResponse.json({ error: 'unknown blueprint' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'solution-blueprint.delete',
    resource: `solution-blueprint:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
