import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { parseObservationInput } from '@/lib/solution-blueprint-request';
import {
  createSolutionObservation,
  listSolutionObservations,
} from '@/lib/solution-blueprints-store';
import { solutionErrorResponse } from '@/lib/solution-http';
import { currentOrgId } from '@/lib/tenancy';

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({
    object: 'list',
    data: await listSolutionObservations((await params).id, orgId),
  });
}

export async function POST(req: Request, { params }: Context) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const input = parseObservationInput(await req.json().catch(() => null));
  if (!input)
    return NextResponse.json({ error: 'a JSON observation is required' }, { status: 400 });
  const orgId = await currentOrgId();
  const deploymentId = (await params).id;
  try {
    const observation = await createSolutionObservation(
      deploymentId,
      orgId,
      input,
      gate.user.email ?? 'unknown-admin',
    );
    auditFromSession(gate, orgId, {
      action: 'solution-observation.create',
      resource: `solution-deployment:${deploymentId} observation:${observation.id}`,
      outcome: 'ok',
    });
    return NextResponse.json(observation, { status: 201 });
  } catch (error) {
    const response = solutionErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
