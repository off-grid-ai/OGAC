import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { deleteTeam, getTeam, updateTeam } from '@/lib/teams';
import { validateTeamUpdate } from '@/lib/teams-policy';
import { listPipelinesByTeam, setPipelineTeam } from '@/lib/pipelines';

export const dynamic = 'force-dynamic';

// One team: read, update, or delete. Admin-gated, org-scoped, audited. Deleting a team CLEARS the
// team_id of any pipeline that pointed at it (so a pipeline is never orphaned onto a dangling team) —
// that cross-table clear lives here, not in the team store (SOLID).

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const team = await getTeam(id, orgId);
  if (!team) return NextResponse.json({ error: 'unknown team' }, { status: 404 });
  return NextResponse.json(team);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const check = validateTeamUpdate({ name: body?.name, description: body?.description });
  if (!check.ok) {
    return NextResponse.json({ error: check.errors.join('; '), errors: check.errors }, { status: 400 });
  }

  const patch: Parameters<typeof updateTeam>[1] = {};
  if (body?.name !== undefined) patch.name = String(body.name).trim();
  if (body?.description !== undefined) patch.description = String(body.description);

  const orgId = await currentOrgId();
  const updated = await updateTeam(id, patch, orgId);
  if (!updated) return NextResponse.json({ error: 'unknown team' }, { status: 404 });
  auditFromSession(gate, orgId, { action: 'team.update', resource: `team:${id}`, outcome: 'ok' });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  // Clear the team off any pipeline that pointed at it BEFORE deleting the team, so no pipeline is
  // left referencing a team that no longer exists.
  const bound = await listPipelinesByTeam(id, orgId).catch(() => []);
  for (const p of bound) await setPipelineTeam(p.id, null, orgId);

  const removed = await deleteTeam(id, orgId);
  if (!removed) return NextResponse.json({ error: 'unknown team' }, { status: 404 });
  auditFromSession(gate, orgId, { action: 'team.delete', resource: `team:${id}`, outcome: 'ok' });
  return NextResponse.json({ deleted: true, clearedPipelines: bound.length });
}
