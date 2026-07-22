import { NextResponse } from 'next/server';
import { AppValidationError, TemplateBindError } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireWriter } from '@/lib/authz';
import { solutionErrorResponse } from '@/lib/solution-http';
import {
  deployRegisteredSolutionTemplate,
  SolutionTemplateDeploymentError,
} from '@/lib/solution-template-deployment';
import { parseSolutionTemplateDeploymentRequest } from '@/lib/solution-template-deployment-request';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function deploymentErrorResponse(error: SolutionTemplateDeploymentError): NextResponse {
  if (error.code === 'not-found') {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
  }
  if (error.code === 'template-mismatch') {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
  }
  if (error.code === 'cleanup-failed') {
    return NextResponse.json(
      {
        error: 'The solution could not be deployed or safely cleaned up',
        code: error.code,
        action: 'Ask an operator to remove the private draft before trying again',
      },
      { status: 500 },
    );
  }
  return NextResponse.json(
    { error: error.message, code: error.code, errors: error.errors },
    { status: 422 },
  );
}

/** Create one governed App instance from the Blueprint's exact registered template. */
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;

  const parsed = parseSolutionTemplateDeploymentRequest(await req.json().catch(() => null));
  if (!parsed.value) {
    return NextResponse.json(
      { error: 'The deployment request needs attention', errors: parsed.errors },
      { status: parsed.errors.includes('a JSON deployment request is required') ? 400 : 422 },
    );
  }

  const { id } = await params;
  const orgId = await currentOrgId();
  const actor = {
    userId: gate.user.email ?? 'service@offgrid.local',
    role: gate.user.role,
  };
  try {
    const receipt = await deployRegisteredSolutionTemplate(id, orgId, actor, parsed.value);
    auditFromSession(gate, orgId, {
      action: 'solution-template.deploy',
      resource: `solution-deployment:${receipt.deploymentId}`,
      outcome: 'ok',
    });
    return NextResponse.json({ receipt }, { status: 201 });
  } catch (error) {
    auditFromSession(gate, orgId, {
      action: 'solution-template.deploy',
      resource: `solution-blueprint:${id}`,
      outcome: 'error',
    });
    if (error instanceof SolutionTemplateDeploymentError) {
      return deploymentErrorResponse(error);
    }
    if (error instanceof TemplateBindError) {
      return NextResponse.json({ error: error.message, bind: error.bind }, { status: 422 });
    }
    if (error instanceof AppValidationError) {
      return NextResponse.json({ error: error.message, errors: error.errors }, { status: 422 });
    }
    const response = solutionErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
