import { CheckCircle, Gauge, Pulse, Rows } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { ScoreTrendChart } from '@/components/analytics/AnalyticsCharts';
import { PipelineFacetSelect } from '@/components/pipelines/PipelineFacetSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatRail } from '@/components/ui/StatRail';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getEvals, getFlags } from '@/lib/adapters/registry';
import { listEvalRuns } from '@/lib/evals';
import { requireModuleForUser } from '@/lib/module-access';
import { evaluateThresholdAlerts } from '@/lib/observability-settings';
import { listPipelines } from '@/lib/pipelines';
import { resolvePipelineFacet } from '@/lib/pipelines-policy';
import { scoringConfigured } from '@/lib/qa/scoring';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function QualityScorecardsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await requireModuleForUser('observability');
  const orgId = await currentOrgId();
  const [params, pipelines, onlineEnabled] = await Promise.all([
    searchParams,
    listPipelines(orgId).catch(() => []),
    getFlags()
      .isEnabled('online-evals', true)
      .catch(() => true),
  ]);
  const facet = resolvePipelineFacet(
    params.pipeline,
    pipelines.map((pipeline) => pipeline.id),
  );
  const runs = await listEvalRuns(100, orgId, facet).catch(() => []);
  const latest = runs[0];
  const trend = [...runs].reverse().map((run, index) => ({
    label: `#${index + 1}`,
    score: run.score,
  }));
  const alerts = await evaluateThresholdAlerts({
    driftScore: null,
    evalPassRate: latest ? latest.score / 100 : null,
  }).catch(() => []);
  const facetName = facet
    ? (pipelines.find((pipeline) => pipeline.id === facet)?.name ?? facet)
    : null;
  const onlineScoring = scoringConfigured();

  const stats = [
    { label: 'Latest score', value: latest ? `${latest.score}%` : '—', icon: Gauge },
    { label: 'Recorded runs', value: String(runs.length), icon: Rows },
    {
      label: 'Latest pass count',
      value: latest ? `${latest.passed}/${latest.total}` : '—',
      icon: CheckCircle,
    },
    {
      label: 'Online scoring',
      value: onlineScoring ? (onlineEnabled ? 'live' : 'paused') : 'local',
      icon: Pulse,
    },
  ];

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-xs text-muted-foreground">
          {facetName
            ? `Showing score history for ${facetName}.`
            : 'Showing score history across all pipelines.'}{' '}
          Evaluator definitions, golden cases, and executions remain owned by Solutions Quality.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <PipelineFacetSelect
            pipelines={pipelines.map((pipeline) => ({ id: pipeline.id, name: pipeline.name }))}
          />
          <Button asChild variant="outline">
            <Link href="/solutions/quality/runs">Manage executions</Link>
          </Button>
        </div>
      </div>

      {alerts.map((alert) => (
        <div
          key={`${alert.metric}-${alert.rule.op}-${alert.rule.value}`}
          className={`rounded-md border px-3 py-2 text-xs ${
            alert.severity === 'critical'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-border bg-muted/40 text-foreground'
          }`}
        >
          Threshold breached: {alert.message}
        </div>
      ))}

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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="shadow-sm xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Score history</CardTitle>
            <p className="text-xs text-muted-foreground">
              Engine: {getEvals().meta.id}. Newest result is on the right.
            </p>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <p className="py-12 text-center text-xs text-muted-foreground">
                No scorecards yet. Launch an execution from Solutions Quality.
              </p>
            ) : (
              <ScoreTrendChart data={trend} />
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm xl:col-span-3">
          <CardHeader>
            <CardTitle className="text-sm">Recent scorecards</CardTitle>
            <p className="text-xs text-muted-foreground">
              Open a run for its immutable per-case result detail.
            </p>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="py-12 text-center text-xs text-muted-foreground">No runs recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Passed</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead className="text-right">Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-mono text-xs text-foreground">
                          {run.id}
                        </TableCell>
                        <TableCell className="text-right font-medium text-foreground">
                          {run.score}%
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {run.passed}/{run.total}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {run.startedAt.slice(0, 16).replace('T', ' ')}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/insights/quality/evals/${encodeURIComponent(run.id)}`}
                            className="text-xs text-primary hover:underline"
                          >
                            View scorecard
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
