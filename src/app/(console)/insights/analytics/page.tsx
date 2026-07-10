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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { computeAnalytics } from '@/lib/analytics';
import { requireModuleForUser } from '@/lib/module-access';
import { safeSupersetDashboard } from '@/lib/superset-data';
import { PipelineFacetSelect } from '@/components/pipelines/PipelineFacetSelect';
import { pipelineTag } from '@/lib/pipeline-api-key-format';
import { resolvePipelineFacet } from '@/lib/pipelines-policy';
import { listPipelines } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string }>;
}) {
  await requireModuleForUser('analytics');
  const { pipeline: rawPipeline } = await searchParams;
  const orgId = await currentOrgId();
  const pipelines = await listPipelines(orgId).catch(() => []);
  const facet = resolvePipelineFacet(rawPipeline, pipelines.map((p) => p.id));
  const facetName = facet ? pipelines.find((p) => p.id === facet)?.name ?? facet : null;
  const a = await computeAnalytics(facet ? pipelineTag(facet) : null);

  const stats = [
    { label: 'Events (5k window)', value: a.totalEvents.toLocaleString(), icon: Activity },
    { label: 'Tokens', value: a.totalTokens.toLocaleString(), icon: Coins },
    { label: 'p95 latency', value: `${a.p95} ms`, icon: Gauge },
    { label: 'Egress rate', value: `${a.egressRate}%`, icon: Send },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Traffic, latency, token and outcome rollups from real gateway traffic on-prem.
            {facetName ? (
              <span className="text-foreground"> Filtered to pipeline “{facetName}”.</span>
            ) : null}
          </p>
        </div>
        <PipelineFacetSelect pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))} />
      </div>

      {a.drift.flagged || a.perf.flagged ? (
        <div className="space-y-2">
          {a.drift.flagged ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="size-4" />
              Drift detected — blocked/redacted rate {(a.drift.recent * 100).toFixed(0)}% recent vs{' '}
              {(a.drift.baseline * 100).toFixed(0)}% baseline.
            </div>
          ) : null}
          {a.perf.flagged ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
              <AlertTriangle className="size-4" />
              Performance degradation — p95 latency {a.perf.recent} ms recent vs {a.perf.baseline}{' '}
              ms baseline.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-foreground">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Events per day</CardTitle>
          </CardHeader>
          <CardContent>
            <EventsChart data={a.series} />
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Avg latency per day</CardTitle>
          </CardHeader>
          <CardContent>
            <LatencyChart data={a.series} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Tokens by model</CardTitle>
          </CardHeader>
          <CardContent>
            <ModelTokensChart data={a.byModel} />
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Outcomes</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 pt-2">
            <div>
              <div className="text-2xl font-semibold text-primary">{a.outcomes.ok}</div>
              <div className="text-xs text-muted-foreground">ok</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-foreground">{a.outcomes.redacted}</div>
              <div className="text-xs text-muted-foreground">redacted</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-destructive">{a.outcomes.blocked}</div>
              <div className="text-xs text-muted-foreground">blocked</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Suspense fallback={null}>
        <AnalyticsAlerts />
      </Suspense>

      <GatewayUsage />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Superset dashboards</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Native BI over the governed data. The embed UUID is verified against Superset before a
            guest token is minted — a missing dashboard shows a provisioning action, never a blank
            iframe.
          </p>
        </CardHeader>
        <CardContent>
          <SupersetEmbed supersetBase={supersetBase()} />
        </CardContent>
      </Card>
    </div>
  );
}
