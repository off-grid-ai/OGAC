import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { parseDeploymentInput } from '@/lib/solution-blueprint-request';
import { createSolutionDeployment, listSolutionDeployments, SolutionValidationError } from '@/lib/solution-blueprints-store';
import { currentOrgId } from '@/lib/tenancy';

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ object: 'list', data: await listSolutionDeployments(await currentOrgId()) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const input = parseDeploymentInput(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ error: 'a JSON deployment is required' }, { status: 400 });
  const orgId = await currentOrgId();
  try {
    const created = await createSolutionDeployment(orgId, input);
    auditFromSession(gate, orgId, { action: 'solution-deployment.create', resource: `solution-deployment:${created.id}`, outcome: 'ok' });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof SolutionValidationError) return NextResponse.json({ error: 'invalid deployment', errors: error.errors }, { status: 422 });
    throw error;
  }
}
