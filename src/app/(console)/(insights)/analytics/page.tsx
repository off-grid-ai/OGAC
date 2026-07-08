import Link from 'next/link';
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
import { SupersetEmbed } from '@/components/analytics/SupersetEmbed';
import { GatewayUsage } from '@/components/gateway/GatewayUsage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { computeAnalytics } from '@/lib/analytics';
import { requireModuleForUser } from '@/lib/module-access';
import { supersetBase } from '@/lib/superset';

export const dynamic = 'force-dynamic';

// Analytics reads REAL gateway traffic from OpenSearch (index `offgrid-gateway`) — the SAME durable
// sink Usage & Spend / logs read. The pipeline facet (?pipeline=) scopes every rollup to one
// governed gateway/pipeline; it's URL-driven (server round-trip, deep-linkable, Back-coherent — the
// nav mandate), mirroring the range facet on Usage & Spend. Options come from real data only.
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string }>;
}) {
  await requireModuleForUser('analytics');
  const { pipeline: rawPipeline } = await searchParams;
  const pipeline = rawPipeline?.trim() || undefined;
  const a = await computeAnalytics(pipeline);

  // Honest empty state: no telemetry yet vs. an active (possibly filtered) window.
  const hasData = a.totalEvents > 0;

  // Facet options = the pipelines actually present. When a filter is active but its pipeline no
  // longer appears in the window, still show it as a chip so the selection stays visible.
  const pipelineOptions = pipeline && !a.pipelines.includes(pipeline)
    ? [...a.pipelines, pipeline].sort()
    : a.pipelines;

  const stats = [
    { label: 'Events', value: a.totalEvents.toLocaleString(), icon: Activity },
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
            Events, tokens, latency, and outcomes over real gateway traffic on-prem
            {pipeline ? (
              <>
                {' '}— scoped to pipeline <span className="font-medium text-foreground">{pipeline}</span>
              </>
            ) : null}
            .
          </p>
        </div>
        {/* Pipeline facet — URL driven (server round-trip, deep-linkable). Only real pipelines. */}
        {pipelineOptions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href="/analytics"
              className={`rounded-md border px-2 py-1 ${!pipeline ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
            >
              All pipelines
            </Link>
            {pipelineOptions.map((p) => (
              <Link
                key={p}
                href={`/analytics?pipeline=${encodeURIComponent(p)}`}
                className={`rounded-md border px-2 py-1 ${pipeline === p ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
              >
                {p}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {!hasData ? (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {pipeline
            ? `No telemetry for pipeline "${pipeline}" in this window — it appears once runs flow through it.`
            : 'No telemetry yet — analytics appear here once runs flow through the gateway.'}
        </div>
      ) : null}

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

      {hasData ? (
        <>
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
        </>
      ) : null}

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
