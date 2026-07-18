import { Gauge, Pulse as Activity, Stack, Waveform } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { LangfuseInsightsPanel } from '@/components/observability/LangfuseInsightsPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import { listAgentRuns } from '@/lib/agentrun';
import {
  resolveRange,
  safeLangfuseInsights,
  safeLangfuseRegistry,
  safeListTraces,
} from '@/lib/langfuse';
import { requireModuleForUser } from '@/lib/module-access';
import { scoringConfigured } from '@/lib/qa/scoring';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function InsightsAiOverviewPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await requireModuleForUser('observability');
  const orgId = await currentOrgId();
  const params = await searchParams;
  const rawRange = Array.isArray(params.lfRange) ? params.lfRange[0] : params.lfRange;
  const { range, fromIso, toIso } = resolveRange(rawRange);
  const [traces, insights, registry, agentRuns] = await Promise.all([
    safeListTraces(100),
    safeLangfuseInsights(fromIso, toIso),
    safeLangfuseRegistry(100),
    listAgentRuns(100, orgId).catch(() => []),
  ]);
  const registryRecords =
    registry.prompts.length + registry.datasets.length + registry.sessions.length;

  const stats = [
    { label: 'Trace records', value: String(traces.traces.length), icon: Waveform },
    { label: 'Governed runs', value: String(agentRuns.length), icon: Activity },
    { label: 'Registry records', value: String(registryRecords), icon: Stack },
    { label: 'Online scoring', value: scoringConfigured() ? 'configured' : 'local', icon: Gauge },
  ];

  return (
    <div className="w-full space-y-6">
      <StatRail>
        {stats.map((stat) => (
          <Card key={stat.label} className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                {stat.label}
              </CardTitle>
              <stat.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-foreground">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </StatRail>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <LeafLink
          href="/insights/ai/traces"
          title="Trace behavior"
          description="Open trace waterfalls and governed run evidence."
        />
        <LeafLink
          href="/insights/ai/prompt-registry"
          title="Registry read-back"
          description="Inspect prompt versions, datasets, and recorded sessions."
        />
        <LeafLink
          href="/insights/ai/copilot"
          title="Ask the platform"
          description="Query operational records with citations to the source evidence."
        />
      </div>

      <LangfuseInsightsPanel
        configured={insights.configured}
        cost={insights.cost}
        trends={insights.trends}
        error={insights.error}
        range={range}
      />
    </div>
  );
}

function LeafLink({
  href,
  title,
  description,
}: Readonly<{ href: string; title: string; description: string }>) {
  return (
    <Link
      href={href}
      className="group rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full shadow-sm transition-colors group-hover:border-primary/50 motion-reduce:transition-none">
        <CardHeader>
          <CardTitle className="text-sm group-hover:text-primary">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{description}</p>
        </CardHeader>
      </Card>
    </Link>
  );
}
