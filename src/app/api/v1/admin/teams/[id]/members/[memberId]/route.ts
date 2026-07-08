import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { auditFromSession } from '@/lib/audit-actor';
import { currentOrgId } from '@/lib/tenancy';
import { removeTeamMember } from '@/lib/teams';

export const dynamic = 'force-dynamic';

// Remove one member from a team by membership id. Admin-gated, org-scoped, audited.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { id, memberId } = await params;
  const orgId = await currentOrgId();
  const removed = await removeTeamMember(memberId, orgId);
  if (!removed) return NextResponse.json({ error: 'unknown member' }, { status: 404 });
  auditFromSession(gate, orgId, {
    action: 'team.member.remove',
    resource: `team:${id}`,
    outcome: 'ok',
  });
  return NextResponse.json({ deleted: true });
}
