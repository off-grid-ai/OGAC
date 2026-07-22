import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getPipeline } from '@/lib/pipelines';
import { isTeamEntityAction } from '@/lib/team-access';
import { resolveTeamEntityAccess } from '@/lib/teams';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ── Team-access EVALUATE — the honest allow/deny probe for team RBAC scoping ─────────────────────
// Resolves, through the REAL production rule (resolveTeamEntityAccess → resolveLifecycleRole →
// team membership + role), whether a given user may take an action on a team-governed pipeline.
// Admin-only to call. This is the same decision the lifecycle guards enforce — exposed so an operator
// (and our verification) can see WHY a member is/ isn't permitted, without impersonating them.
export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as {
    userEmail?: unknown;
    pipelineId?: unknown;
    action?: unknown;
  } | null;
  const userEmail = typeof body?.userEmail === 'string' ? body.userEmail.trim() : '';
  const pipelineId = typeof body?.pipelineId === 'string' ? body.pipelineId.trim() : '';
  const action = body?.action;
  if (!userEmail || !pipelineId) {
    return NextResponse.json({ error: 'userEmail and pipelineId are required' }, { status: 400 });
  }
  if (!isTeamEntityAction(action)) {
    return NextResponse.json({ error: 'action must be view|run|trigger|edit|approve|delete' }, { status: 400 });
  }

  const org = await currentOrgId();
  const pipeline = await getPipeline(pipelineId, org);
  if (!pipeline) return NextResponse.json({ error: 'unknown pipeline' }, { status: 404 });

  const decision = await resolveTeamEntityAccess({
    // Evaluate as a PLAIN user — team membership + role is the only authority (so the probe reflects
    // team scoping, not admin/approver bypass).
    actor: { email: userEmail, isAdmin: false, isApprover: false },
    entity: { ownerId: pipeline.ownerId, teamId: pipeline.teamId ?? null },
    action,
    orgId: org,
  });
  return NextResponse.json({
    userEmail,
    pipelineId,
    action,
    allow: decision.allow,
    role: decision.role,
    reason: decision.reason,
  });
}
