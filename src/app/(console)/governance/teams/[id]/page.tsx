import { notFound } from 'next/navigation';
import { TeamDetail } from '@/components/teams/TeamDetail';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelinesByTeam } from '@/lib/pipelines';
import { getTeam, listTeamMembers, listTeams } from '@/lib/teams';
import { distinctDepartments } from '@/lib/teams-policy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Team detail (M2) — the full entity + its actions: edit/delete, member CRUD, and the pipelines
// assigned to it. Deep-linkable route (/governance/teams/<id>). 404 for an unknown/cross-org id.
export default async function TeamDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('teams');
  const { id } = await params;
  const orgId = await currentOrgId();
  const team = await getTeam(id, orgId);
  if (!team) notFound();

  const [members, pipelines, allTeams] = await Promise.all([
    listTeamMembers(id, orgId).catch(() => []),
    listPipelinesByTeam(id, orgId).catch(() => []),
    listTeams(orgId).catch(() => []),
  ]);

  return (
    <TeamDetail
      team={{
        id: team.id,
        name: team.name,
        description: team.description,
        department: team.department,
        members: members.map((m) => ({ id: m.id, userId: m.userId, role: m.role })),
        pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, status: p.status })),
      }}
      departments={distinctDepartments(allTeams)}
    />
  );
}
