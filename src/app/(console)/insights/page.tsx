import { DomainDashboard } from '@/components/domain-dashboard/DomainDashboard';
import { ModuleCard, type ModuleLink } from '@/components/ModuleCard';
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
      <div className="space-y-6">
        <DomainDashboard model={model} />
        <div className="border-t border-border pt-6">
          <h2 className="text-base font-normal text-foreground">Inspect evidence</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            See how the AI behaves — quality, drift, cost, usage, and outcomes from real runs.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INSIGHTS_MODULES.map((m) => (
            <ModuleCard key={m.href} {...m} />
          ))}
        </div>
      </div>
    </PageFrame>
  );
}

const INSIGHTS_MODULES: ModuleLink[] = [
  { title: 'Quality', href: '/insights/quality', description: 'Eval scores + LLM-judge faithfulness on governed answers.' },
  { title: 'Drift', href: '/insights/drift', description: 'Dataset + behaviour drift detection over time.' },
  { title: 'Cost', href: '/insights/cost', description: 'Spend by model, pipeline, user, and project.' },
  { title: 'Usage', href: '/insights/usage', description: 'Request volume, tokens, and adoption trends.' },
  { title: 'Outcomes', href: '/insights/outcomes', description: 'Business outcomes + ROI from shipped app runs.' },
  { title: 'Audit', href: '/insights/audit', description: 'Who-did-what, what was blocked, and the SIEM feed.' },
];
