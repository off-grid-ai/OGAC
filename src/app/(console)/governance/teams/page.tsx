import { TeamsManager } from '@/components/teams/TeamsManager';
import { requireModuleForUser } from '@/lib/module-access';
import { listTeams } from '@/lib/teams';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Teams / BU library surface (M2). Full-width list → detail. Admin module (management control plane).
export default async function TeamsPage() {
  await requireModuleForUser('teams');
  const orgId = await currentOrgId();
  const teams = await listTeams(orgId);
  return (
    <TeamsManager
      teams={teams.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        memberCount: t.memberCount,
      }))}
    />
  );
}
