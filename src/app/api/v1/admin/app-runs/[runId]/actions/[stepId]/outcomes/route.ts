import { NextResponse } from 'next/server';
import { listActionOutcomes, recordActionOutcome } from '@/lib/action-outcome-observation-store';
import { parseActionOutcomeRequest } from '@/lib/action-outcome-request';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { actionOutcomeErrorResponse } from './_http';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ runId: string; stepId: string }>;
}

export async function GET(req: Request, { params }: RouteContext) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { runId, stepId } = await params;
  const orgId = await currentOrgId();
  const data = await listActionOutcomes(runId, stepId, orgId);
  return NextResponse.json({ data });
}

export async function POST(req: Request, { params }: RouteContext) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { runId, stepId } = await params;
  const parsed = parseActionOutcomeRequest(await req.json().catch(() => ({})), {
    runId,
    stepId,
    kind: 'observed',
  });
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid business result', errors: parsed.errors },
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
      action: 'app.action-outcome.record',
      resource: `app_run:${runId} action:${stepId}`,
      outcome: 'ok',
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return (
      actionOutcomeErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to record business result' }, { status: 500 })
    );
  }
}
