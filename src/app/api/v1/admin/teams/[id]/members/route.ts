import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { addTeamMember, getTeam, listTeamMembers } from '@/lib/teams';
import { normalizeTeamMemberRole, validateMember } from '@/lib/teams-policy';

export const dynamic = 'force-dynamic';

// A team's membership: list (GET) + add/update-role (POST, upsert on (team,user)). Admin-gated,
// org-scoped, audited. Pure validation lives in teams-policy.ts.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();
  const team = await getTeam(id, orgId);
  if (!team) return NextResponse.json({ error: 'unknown team' }, { status: 404 });
  return NextResponse.json({ object: 'list', data: await listTeamMembers(id, orgId) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id } = await params;
  const orgId = await currentOrgId();

  const team = await getTeam(id, orgId);
  if (!team) return NextResponse.json({ error: 'unknown team' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const check = validateMember({ userId: body?.userId, role: body?.role });
  if (!check.ok) {
    return NextResponse.json({ error: check.errors.join('; '), errors: check.errors }, { status: 400 });
  }

  const member = await addTeamMember(
    id,
    String(body?.userId).trim(),
    normalizeTeamMemberRole(body?.role),
    orgId,
  );
  auditFromSession(gate, orgId, {
    action: 'team.member.add',
    resource: `team:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json(member, { status: 201 });
}
