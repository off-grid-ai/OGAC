import { NextResponse } from 'next/server';
import { listActionOutcomes, recordActionOutcome } from '@/lib/action-outcome-observation-store';
import { parseActionOutcomeRequest } from '@/lib/action-outcome-request';
import { callerFromSession } from '@/lib/app-access-caller';
import type { AppAction } from '@/lib/app-access-policy';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import { enforceAppAccessWithSharing } from '@/lib/app-sharing';
import { getAppAccessSubject } from '@/lib/apps-store';
import { auditFromSession } from '@/lib/audit-actor';
import { requireUser, requireWriter, type AuthzSession } from '@/lib/authz';
import { currentOrgId } from '@/lib/tenancy';
import { actionOutcomeErrorResponse } from './_http';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string; stepId: string }>;
}

async function enforceOutcomeAccess(input: {
  gate: AuthzSession;
  orgId: string;
  runId: string;
  action: Extract<AppAction, 'view' | 'run'>;
}): Promise<NextResponse | null> {
  const run = await getAppRunView(input.runId, input.orgId);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const app = await getAppAccessSubject(run.appId, input.orgId);
  if (!app) return NextResponse.json({ error: 'App not found' }, { status: 404 });
  const caller = await callerFromSession(input.gate, input.orgId);
  const access = await enforceAppAccessWithSharing({
    appId: app.id,
    orgId: input.orgId,
    ownerId: app.ownerId,
    caller,
    action: input.action,
    requestAttrs: run.input ?? {},
  });
  if (access.allow) return null;
  auditFromSession(input.gate, input.orgId, {
    action: 'access.denied',
    resource: `app_run:${input.runId} action-outcome:${input.action}`,
    outcome: 'blocked',
  });
  return NextResponse.json({ error: 'access denied', reason: access.reason }, { status: 403 });
}

export async function GET(req: Request, { params }: RouteContext) {
  const gate = await requireUser(req);
  if (gate instanceof NextResponse) return gate;
  const { id: runId, stepId } = await params;
  const orgId = await currentOrgId();
  const denied = await enforceOutcomeAccess({ gate, orgId, runId, action: 'view' });
  if (denied) return denied;
  const data = await listActionOutcomes(runId, stepId, orgId);
  return NextResponse.json({ data });
}

export async function POST(req: Request, { params }: RouteContext) {
  const gate = await requireWriter(req);
  if (gate instanceof NextResponse) return gate;
  const { id: runId, stepId } = await params;
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
  const denied = await enforceOutcomeAccess({ gate, orgId, runId, action: 'run' });
  if (denied) return denied;
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
