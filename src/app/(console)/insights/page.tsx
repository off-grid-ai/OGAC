import { DomainDashboard } from '@/components/domain-dashboard/DomainDashboard';
import { PageFrame } from '@/components/PageFrame';
import { listAgentRuns } from '@/lib/agentrun';
import { buildDomainDashboard } from '@/lib/domain-dashboard';
import { currentOrgId } from '@/lib/tenancy';
import { safeWithTimeout } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

// Insights section OVERVIEW — the home of the "see how the AI behaves" plane. Headline facts from the
// real run ledger (volume + how many hit an error) + the most recent runs, over the section's
// auto-linked sub-modules (evals, quality, drift, cost, usage, outcomes). Honest: no ledger ⇒
// "Unavailable", never fabricated.
export default async function InsightsPage() {
  const orgId = await currentOrgId();
  const runs = await safeWithTimeout(() => listAgentRuns(50, orgId), 1500, null);
  const errored = runs?.filter((r) => r.status === 'error' || r.status === 'failed').length ?? 0;
  const done = runs?.filter((r) => r.status === 'done' || r.status === 'succeeded').length ?? 0;

  const model = buildDomainDashboard('insights', {
    facts: [
      {
        label: 'Recent runs',
        value: runs ? runs.length.toLocaleString() : 'Unavailable',
        description: runs ? 'Governed AI executions in the recent window.' : 'Run ledger did not respond.',
        href: '/operations/runs',
        state: runs ? 'neutral' : 'attention',
      },
      {
        label: 'Completed',
        value: runs ? done.toLocaleString() : 'Unavailable',
        description: 'Runs that finished successfully.',
        href: '/insights/quality',
        state: runs ? 'good' : 'attention',
      },
      {
        label: 'Errored',
        value: runs ? errored.toLocaleString() : 'Unavailable',
        description: 'Runs that halted on a guardrail, policy, or failure.',
        href: '/insights/drift',
        state: errored > 0 ? 'attention' : runs ? 'good' : 'attention',
      },
    ],
    activities: (runs ?? []).slice(0, 6).map((r) => ({
      id: r.id,
      label: r.query ? r.query.slice(0, 60) : r.agentId,
      detail: `${r.agentId} · ${r.status}`,
      href: `/operations/runs/agent:${r.id}`,
    })),
  });

  return (
    <PageFrame>
      <DomainDashboard model={model} />
    </PageFrame>
  );
}
