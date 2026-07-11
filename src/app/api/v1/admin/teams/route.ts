import { NextResponse } from 'next/server';
import { auditFromSession } from '@/lib/audit-actor';
import { requireAdmin } from '@/lib/authz';
import { createTeam, listTeams } from '@/lib/teams';
import { validateTeamCreate } from '@/lib/teams-policy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Team / BU collection (M2 lifecycle & ownership — the TEAM tier) ──────────────────────────────
// A team sits between the org and the pipeline; its members get delegated access to their team's
// pipelines. Admin-gated, org-scoped, audited. Pure validation lives in teams-policy.ts; persistence
// in teams.ts.

export async function GET(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const orgId = await currentOrgId();
  return NextResponse.json({ object: 'list', data: await listTeams(orgId) });
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const check = validateTeamCreate({
    name: body?.name,
    description: body?.description,
    department: body?.department,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.errors.join('; '), errors: check.errors }, { status: 400 });
  }

  const orgId = await currentOrgId();
  const created = await createTeam(
    {
      name: String(body?.name ?? '').trim(),
      description: typeof body?.description === 'string' ? body.description : '',
      department: typeof body?.department === 'string' ? body.department : null,
    },
    orgId,
  );
  auditFromSession(gate, orgId, {
    action: 'team.create',
    resource: `team:${created.id}`,
    outcome: 'ok',
  });
  return NextResponse.json(created, { status: 201 });
}
