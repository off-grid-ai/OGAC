import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { parseBlueprintInput } from '@/lib/solution-blueprint-request';
import { createSolutionBlueprint, listSolutionBlueprints } from '@/lib/solution-blueprints-store';
import { solutionErrorResponse } from '@/lib/solution-http';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({
    object: 'list',
    data: await listSolutionBlueprints(await currentOrgId()),
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const input = parseBlueprintInput(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ error: 'a JSON blueprint is required' }, { status: 400 });
  const orgId = await currentOrgId();
  try {
    const created = await createSolutionBlueprint(orgId, input, gate.user.email ?? 'unknown-admin');
    auditFromSession(gate, orgId, {
      action: 'solution-blueprint.create',
      resource: `solution-blueprint:${created.id}`,
      outcome: 'ok',
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const response = solutionErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
