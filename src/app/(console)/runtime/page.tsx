import { DomainDashboard } from '@/components/domain-dashboard/DomainDashboard';
import { PageFrame } from '@/components/PageFrame';
import { buildDomainDashboard } from '@/lib/domain-dashboard';
import { listGatewayRows } from '@/lib/gateways';
import { listPipelines } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';
import { safeWithTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

export default async function RuntimePage() {
  const orgId = await currentOrgId();
  const [gateways, pipelines] = await Promise.all([
    safeWithTimeout(() => listGatewayRows(orgId), 1200, null),
    safeWithTimeout(() => listPipelines(orgId), 1200, null),
  ]);
  const enabledGateways = gateways?.filter((gateway) => gateway.enabled).length;
  const assignedModels = gateways
    ? new Set(gateways.map((gateway) => gateway.defaultModel).filter(Boolean)).size
    : null;
  const publishedPipelines = pipelines?.filter(
    (pipeline) => pipeline.status === 'published',
  ).length;

  const model = buildDomainDashboard('runtime', {
    facts: [
      {
        label: 'Enabled gateways',
        value: gateways ? `${enabledGateways} / ${gateways.length}` : 'Unavailable',
        description: gateways
          ? 'Registered endpoints allowed to receive requests.'
          : 'Gateway records did not respond.',
        href: '/runtime/gateways',
        state: gateways ? 'neutral' : 'attention',
      },
      {
        label: 'Assigned models',
        value: assignedModels === null ? 'Unavailable' : assignedModels.toLocaleString(),
        description: gateways
          ? 'Distinct default model assignments in the gateway registry.'
          : 'Model assignments did not respond.',
        href: '/runtime/models',
        state: gateways ? 'neutral' : 'attention',
      },
      {
        label: 'Published pipelines',
        value: pipelines ? `${publishedPipelines} / ${pipelines.length}` : 'Unavailable',
        description: pipelines
          ? 'Governed access contracts currently published.'
          : 'Pipeline records did not respond.',
        href: '/runtime/pipelines',
        state: pipelines ? 'neutral' : 'attention',
      },
    ],
    activities: (pipelines ?? []).slice(0, 6).map((pipeline) => ({
      id: pipeline.id,
      label: pipeline.name,
      detail: `${pipeline.status} - version ${pipeline.version}`,
      timestamp: pipeline.updatedAt?.slice(0, 10),
      href: `/runtime/pipelines/${pipeline.id}`,
    })),
  });

  return (
    <PageFrame>
      <DomainDashboard model={model} />
    </PageFrame>
  );
}
