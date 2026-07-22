import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { disableTeamLogging, setTeamCallback } from '@/lib/adapters/litellm-callbacks';
import { planDisableTeamLogging, planTeamCallback, teamCallbackAuditResource } from '@/lib/litellm-callbacks';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Team-scoped structured-callback lever — the ONE runtime-supported callback write the deployed proxy
// has (global success/failure callbacks are deploy-owned + reload-required). POST attaches a callback
// sink to a team (e.g. point that team's structured logs at Langfuse/OTel); DELETE disables a team's
// callback logging. The pure planners validate + shape; the adapter POSTs the proxy API. Every
// mutation is AUDITED (routing.change).
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => ({}))) as unknown;
  const plan = planTeamCallback((body ?? {}) as Record<string, unknown>);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  const result = await setTeamCallback(plan);
  const org = await currentOrgId();
  auditFromSession(gate, org, {
    action: 'routing.change',
    resource: `${teamCallbackAuditResource(plan)}.set`,
    outcome: result.ok ? 'ok' : 'error',
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const teamId = new URL(req.url).searchParams.get('teamId');
  const plan = planDisableTeamLogging(teamId);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  const result = await disableTeamLogging(plan.teamId);
  const org = await currentOrgId();
  auditFromSession(gate, org, {
    action: 'routing.change',
    resource: `gateway.callbacks.team(${plan.teamId}).disable`,
    outcome: result.ok ? 'ok' : 'error',
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
