import { DomainDashboard } from '@/components/domain-dashboard/DomainDashboard';
import { PageFrame } from '@/components/PageFrame';
import { listAgentRuns } from '@/lib/agentrun';
import { listApps } from '@/lib/apps-store';
import { buildDomainDashboard } from '@/lib/domain-dashboard';
import { listSolutionBlueprints, listSolutionDeployments } from '@/lib/solution-blueprints-store';
import { currentOrgId } from '@/lib/tenancy';
import { safeWithTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

export default async function SolutionsRoot() {
  const orgId = await currentOrgId();
  const [apps, blueprints, deployments, runs] = await Promise.all([
    safeWithTimeout(() => listApps(orgId), 1200, null),
    safeWithTimeout(() => listSolutionBlueprints(orgId), 1200, null),
    safeWithTimeout(() => listSolutionDeployments(orgId), 1200, null),
    safeWithTimeout(() => listAgentRuns(6, orgId), 1200, null),
  ]);
  const publishedApps = apps?.filter((app) => app.published).length;
  const activeDeployments = deployments?.filter(
    (deployment) => deployment.status === 'active',
  ).length;

  const model = buildDomainDashboard('solutions', {
    facts: [
      {
        label: 'Apps',
        value: apps ? apps.length.toLocaleString() : 'Unavailable',
        description: apps ? `${publishedApps} published for use.` : 'App records did not respond.',
        href: '/solutions/apps',
        state: apps ? 'neutral' : 'attention',
      },
      {
        label: 'Blueprints',
        value: blueprints ? blueprints.length.toLocaleString() : 'Unavailable',
        description: blueprints
          ? 'Reusable business process definitions.'
          : 'Blueprint records did not respond.',
        href: '/solutions/library',
        state: blueprints ? 'neutral' : 'attention',
      },
      {
        label: 'Active deployments',
        value: deployments ? String(activeDeployments) : 'Unavailable',
        description: deployments
          ? 'Blueprints bound to active tenant apps.'
          : 'Deployment records did not respond.',
        href: '/solutions/deployed',
        state: deployments ? 'neutral' : 'attention',
      },
    ],
    activities: (runs ?? []).map((run) => ({
      id: run.id,
      label: run.agentId,
      detail: `${run.status}: ${run.query}`,
      timestamp: run.startedAt.slice(0, 10),
      href: `/solutions/agents/${run.agentId}/runs/${run.id}`,
    })),
  });

  return (
    <PageFrame>
      <DomainDashboard model={model} />
    </PageFrame>
  );
}
