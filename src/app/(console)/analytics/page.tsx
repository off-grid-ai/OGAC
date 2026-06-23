import {
  Pulse as Activity,
  Warning as AlertTriangle,
  Coins,
  Gauge,
  PaperPlaneTilt as Send,
} from '@phosphor-icons/react/dist/ssr';
import {
  EventsChart,
  LatencyChart,
  ModelTokensChart,
} from '@/components/analytics/AnalyticsCharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { computeAnalytics } from '@/lib/analytics';
import { requireModule } from '@/lib/modules';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  requireModule('analytics');
  const a = await computeAnalytics();

  const stats = [
    { label: 'Events (5k window)', value: a.totalEvents.toLocaleString(), icon: Activity },
    { label: 'Tokens', value: a.totalTokens.toLocaleString(), icon: Coins },
    { label: 'p95 latency', value: `${a.p95} ms`, icon: Gauge },
    { label: 'Egress rate', value: `${a.egressRate}%`, icon: Send },
  ];

  return (
    <div className="space-y-6">
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
    </div>
  );
}
