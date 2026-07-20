import { DomainDashboard } from '@/components/domain-dashboard/DomainDashboard';
import { PageFrame } from '@/components/PageFrame';
import { buildDomainDashboard } from '@/lib/domain-dashboard';
import { listAllRuns } from '@/lib/runs-monitor-reader';
import { computeStatus } from '@/lib/status';
import { currentOrgId } from '@/lib/tenancy';
import { safeWithTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

export default async function OperationsPage() {
  const orgId = await currentOrgId();
  const [status, runs] = await Promise.all([
    safeWithTimeout(() => computeStatus(), 1500, null),
    safeWithTimeout(() => listAllRuns(orgId), 1500, null),
  ]);
  const liveRuns = runs?.filter(
    (run) => run.status === 'running' || run.status === 'queued',
  ).length;
  const attentionRuns = runs?.filter((run) => run.status === 'failed').length;

  const model = buildDomainDashboard('operations', {
    facts: [
      {
        label: 'Service health',
        value: status ? `${status.up} / ${status.total}` : 'Unavailable',
        description: status
          ? `Overall platform state: ${status.status}.`
          : 'Service probes did not complete.',
        href: '/operations/services',
        state: status?.status === 'operational' ? 'good' : 'attention',
      },
      {
        label: 'Runs in progress',
        value: runs ? String(liveRuns) : 'Unavailable',
        description: runs ? 'Queued or running executions.' : 'Run records did not respond.',
        href: '/operations/runs?status=running',
        state: runs ? 'neutral' : 'attention',
      },
      {
        label: 'Runs needing attention',
        value: runs ? String(attentionRuns) : 'Unavailable',
        description: runs
          ? 'Failed executions in the current read window.'
          : 'Run records did not respond.',
        href: '/operations/runs?status=failed',
        state: attentionRuns ? 'attention' : runs ? 'good' : 'attention',
      },
    ],
    activities: (runs ?? []).slice(0, 6).map((run) => ({
      id: run.key,
      label: run.name,
      detail: `${run.kind} - ${run.status}`,
      timestamp: run.startedAt?.slice(0, 10),
      href: run.href,
    })),
  });

  return (
    <PageFrame>
      <DomainDashboard model={model} />
    </PageFrame>
  );
}
