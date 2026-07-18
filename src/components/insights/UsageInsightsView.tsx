import {
  Pulse as Activity,
  Warning as AlertTriangle,
  Coins,
  Gauge,
  PaperPlaneTilt as Send,
} from '@phosphor-icons/react/dist/ssr';
import { Suspense } from 'react';
import { AnalyticsAlerts } from '@/components/analytics/AnalyticsAlerts';
import {
  EventsChart,
  LatencyChart,
  ModelTokensChart,
} from '@/components/analytics/AnalyticsCharts';
import { NativeSupersetPanel } from '@/components/analytics/NativeSupersetPanel';
import { GatewayUsage } from '@/components/gateway/GatewayUsage';
import {
  PipelineFacetSelect,
  type PipelineFacetOption,
} from '@/components/pipelines/PipelineFacetSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import type { Analytics } from '@/lib/analytics';
import type { InsightsUsageDestinationId } from '@/lib/insights-usage-cost-routes';
import type { NativeSupersetDashboard } from '@/lib/superset-data';

interface UsageInsightsViewProps {
  destination: InsightsUsageDestinationId;
  analytics: Analytics;
  facetName: string | null;
  pipelines: PipelineFacetOption[];
  supersetDashboard?: NativeSupersetDashboard;
}

function FilterBar({
  facetName,
  pipelines,
}: Readonly<Pick<UsageInsightsViewProps, 'facetName' | 'pipelines'>>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
      <p className="text-xs text-muted-foreground">
        {facetName ? (
          <>
            Showing pipeline <span className="text-foreground">{facetName}</span>.
          </>
        ) : (
          'Showing all pipeline traffic.'
        )}
      </p>
      <PipelineFacetSelect pipelines={pipelines} />
    </div>
  );
}

function DegradationNotice({ analytics }: Readonly<{ analytics: Analytics }>) {
  if (!analytics.drift.flagged && !analytics.perf.flagged) return null;
  return (
    <div className="space-y-2" role="status">
      {analytics.drift.flagged ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle className="size-4" />
          Drift detected: blocked/redacted rate {(analytics.drift.recent * 100).toFixed(0)}% recent
          versus {(analytics.drift.baseline * 100).toFixed(0)}% baseline.
        </div>
      ) : null}
      {analytics.perf.flagged ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle className="size-4" />
          Performance degradation: p95 latency {analytics.perf.recent} ms recent versus{' '}
          {analytics.perf.baseline} ms baseline.
        </div>
      ) : null}
    </div>
  );
}

function UsageOverview({ analytics }: Readonly<{ analytics: Analytics }>) {
  const stats = [
    { label: 'Events (5k window)', value: analytics.totalEvents.toLocaleString(), icon: Activity },
    { label: 'Tokens', value: analytics.totalTokens.toLocaleString(), icon: Coins },
    { label: 'p95 latency', value: `${analytics.p95} ms`, icon: Gauge },
    { label: 'Egress rate', value: `${analytics.egressRate}%`, icon: Send },
  ];

  return (
    <div className="space-y-6">
      <DegradationNotice analytics={analytics} />
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
      <Suspense fallback={null}>
        <AnalyticsAlerts />
      </Suspense>
    </div>
  );
}

function UsageTraffic({ analytics }: Readonly<{ analytics: Analytics }>) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Events per day</CardTitle>
        </CardHeader>
        <CardContent>
          <EventsChart data={analytics.series} />
        </CardContent>
      </Card>
      <GatewayUsage />
    </div>
  );
}

function UsageLatency({ analytics }: Readonly<{ analytics: Analytics }>) {
  return (
    <div className="space-y-6">
      {analytics.perf.flagged ? <DegradationNotice analytics={analytics} /> : null}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Average latency per day</CardTitle>
        </CardHeader>
        <CardContent>
          <LatencyChart data={analytics.series} />
        </CardContent>
      </Card>
    </div>
  );
}

function UsageAdoption({ analytics }: Readonly<{ analytics: Analytics }>) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Tokens by model</CardTitle>
        </CardHeader>
        <CardContent>
          <ModelTokensChart data={analytics.byModel} />
        </CardContent>
      </Card>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Outcomes</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3 pt-2">
          <div>
            <div className="text-2xl font-semibold text-primary">{analytics.outcomes.ok}</div>
            <div className="text-xs text-muted-foreground">ok</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-foreground">
              {analytics.outcomes.redacted}
            </div>
            <div className="text-xs text-muted-foreground">redacted</div>
          </div>
          <div>
            <div className="text-2xl font-semibold text-destructive">
              {analytics.outcomes.blocked}
            </div>
            <div className="text-xs text-muted-foreground">blocked</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UsageDashboards({ dashboard }: Readonly<{ dashboard: NativeSupersetDashboard }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">BI dashboards</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Superset runs each governed query and the console renders the result. Open Superset to
          author charts.
        </p>
      </CardHeader>
      <CardContent>
        <NativeSupersetPanel dashboard={dashboard} />
      </CardContent>
    </Card>
  );
}

export function UsageInsightsView({
  destination,
  analytics,
  facetName,
  pipelines,
  supersetDashboard,
}: Readonly<UsageInsightsViewProps>) {
  let content;
  switch (destination) {
    case 'overview':
      content = <UsageOverview analytics={analytics} />;
      break;
    case 'traffic':
      content = <UsageTraffic analytics={analytics} />;
      break;
    case 'latency':
      content = <UsageLatency analytics={analytics} />;
      break;
    case 'adoption':
      content = <UsageAdoption analytics={analytics} />;
      break;
    case 'dashboards':
      content = (
        <UsageDashboards dashboard={supersetDashboard ?? { configured: false, charts: [] }} />
      );
      break;
  }

  return (
    <div className="w-full space-y-6">
      <FilterBar facetName={facetName} pipelines={pipelines} />
      {content}
    </div>
  );
}
