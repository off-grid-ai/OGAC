import { NextResponse } from 'next/server';
import { getActionOutcome, recordActionOutcome } from '@/lib/action-outcome-observation-store';
import { parseActionOutcomeRequest } from '@/lib/action-outcome-request';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { actionOutcomeErrorResponse } from '../_http';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string; stepId: string; outcomeId: string }>;
}

export async function GET(req: Request, { params }: RouteContext) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id: runId, stepId, outcomeId } = await params;
  const orgId = await currentOrgId();
  const observation = await getActionOutcome(outcomeId, runId, stepId, orgId);
  if (!observation)
    return NextResponse.json({ error: 'Business result not found' }, { status: 404 });
  return NextResponse.json({ observation });
}

export async function PATCH(req: Request, { params }: RouteContext) {
  return mutate(req, params, 'corrected');
}

export async function DELETE(req: Request, { params }: RouteContext) {
  return mutate(req, params, 'withdrawn');
}

async function mutate(
  req: Request,
  params: RouteContext['params'],
  kind: 'corrected' | 'withdrawn',
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id: runId, stepId, outcomeId } = await params;
  const parsed = parseActionOutcomeRequest(await req.json().catch(() => ({})), {
    runId,
    stepId,
    kind,
    supersedesId: outcomeId,
  });
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: `invalid business result ${kind === 'corrected' ? 'correction' : 'withdrawal'}`,
        errors: parsed.errors,
      },
      { status: 400 },
    );
  }
  const orgId = await currentOrgId();
  try {
    const result = await recordActionOutcome(
      parsed.value,
      orgId,
      gate.user.email?.trim() || gate.user.name?.trim() || '',
    );
    auditFromSession(gate, orgId, {
      action: kind === 'corrected' ? 'app.action-outcome.correct' : 'app.action-outcome.withdraw',
      resource: `app_run:${runId} action:${stepId} outcome:${outcomeId}`,
      outcome: 'ok',
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return (
      actionOutcomeErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to update business result' }, { status: 500 })
    );
  }
}
