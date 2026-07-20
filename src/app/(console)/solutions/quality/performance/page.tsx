import Link from 'next/link';
import { ScoreTrendChart } from '@/components/analytics/AnalyticsCharts';
import { RunSweepButton } from '@/components/observability/RunSweepButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listEvalRuns } from '@/lib/evals';
import { requireModuleForUser } from '@/lib/module-access';
import { evaluateThresholdAlerts } from '@/lib/observability-settings';
import { readQaStatus } from '@/lib/qa/status';
import { buildQualityPerformance, type PerformanceStatus } from '@/lib/quality-operator-view';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<PerformanceStatus, string> = {
  insufficient: 'bg-muted text-muted-foreground',
  stable: 'bg-primary/10 text-primary',
  warning: 'bg-muted text-foreground',
  degraded: 'bg-destructive/10 text-destructive',
};

export default async function QualityPerformancePage() {
  await requireModuleForUser('evals');
  const orgId = await currentOrgId();
  const [runs, status] = await Promise.all([
    listEvalRuns(100, orgId).catch(() => []),
    readQaStatus(orgId).catch(() => null),
  ]);
  const performance = buildQualityPerformance(runs);
  const alerts = await evaluateThresholdAlerts({
    driftScore: status?.drift.metrics[0]?.value ?? null,
    evalPassRate: performance.latestScore === null ? null : performance.latestScore / 100,
  }).catch(() => []);

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-3xl text-xs text-muted-foreground">Recent executions are compared in equal windows. Degraded means the current mean is at least 15 points below the prior window; warning starts at 7 points. No verdict is shown until four runs exist.</p>
        <RunSweepButton />
      </div>

      {alerts.map((alert) => <div key={`${alert.metric}-${alert.rule.op}-${alert.rule.value}`} className={alert.severity === 'critical' ? 'border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive' : 'border border-border bg-muted/40 px-3 py-2 text-xs'}>Threshold breached: {alert.message}</div>)}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Performance"><Badge variant="secondary" className={STATUS_CLASS[performance.status]}>{performance.status}</Badge></Metric>
        <Metric label="Latest score"><span className="text-2xl">{performance.latestScore === null ? 'not recorded' : `${performance.latestScore}%`}</span></Metric>
        <Metric label="Current mean"><span className="text-2xl">{performance.currentMean === null ? 'not recorded' : `${performance.currentMean}%`}</span></Metric>
        <Metric label="Change"><span className="text-2xl">{performance.delta === null ? 'not available' : `${performance.delta > 0 ? '+' : ''}${performance.delta} pts`}</span></Metric>
        <Metric label="Online scoring"><span className="text-sm">{status?.online.configured ? (status.online.enabled ? 'configured and enabled' : 'configured, flag paused') : 'not configured'}</span></Metric>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2"><CardHeader><CardTitle className="text-sm">Score history</CardTitle><p className="text-xs text-muted-foreground">Oldest result is on the left. Every point links back to an immutable execution record below.</p></CardHeader><CardContent>{performance.trend.length === 0 ? <p className="py-12 text-center text-xs text-muted-foreground">No execution history yet.</p> : <ScoreTrendChart data={performance.trend} />}</CardContent></Card>
        <Card className="xl:col-span-3"><CardHeader><CardTitle className="text-sm">Recorded executions</CardTitle></CardHeader><CardContent>{runs.length === 0 ? <p className="py-12 text-center text-xs text-muted-foreground">Create golden cases and run an evaluator to establish the baseline.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Engine</TableHead><TableHead className="text-right">Score</TableHead><TableHead className="text-right">Passed</TableHead><TableHead>Started</TableHead></TableRow></TableHeader><TableBody>{runs.map((run) => <TableRow key={run.id}><TableCell><Link className="font-mono text-xs text-primary hover:underline" href={`/solutions/quality/runs/${encodeURIComponent(run.id)}`}>{run.id}</Link></TableCell><TableCell><Badge variant="outline">{run.engine}</Badge></TableCell><TableCell className="text-right">{run.score}%</TableCell><TableCell className="text-right text-xs">{run.passed}/{run.total}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{run.startedAt.slice(0, 16).replace('T', ' ')}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
      </div>
    </div>
  );
}

function Metric({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">{label}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>;
}

