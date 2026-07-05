import {
  CheckCircle,
  Gauge,
  Pulse,
  SealCheck,
  Warning as AlertTriangle,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { ScoreTrendChart } from '@/components/analytics/AnalyticsCharts';
import { LangfuseInsightsPanel } from '@/components/observability/LangfuseInsightsPanel';
import { LangfuseTraces } from '@/components/observability/LangfuseTraces';
import { RunSweepButton } from '@/components/observability/RunSweepButton';
import { ThresholdManager } from '@/components/observability/ThresholdManager';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getDrift, getEvals, getFlags } from '@/lib/adapters/registry';
import { listAgentRuns } from '@/lib/agentrun';
import { listEvalRuns } from '@/lib/evals';
import { resolveRange, safeLangfuseInsights, safeListTraces } from '@/lib/langfuse';
import { requireModuleForUser } from '@/lib/module-access';
import { evaluateThresholdAlerts } from '@/lib/observability-settings';
import { currentOrgId } from '@/lib/tenancy';
import { scoringConfigured } from '@/lib/qa/scoring';

export const dynamic = 'force-dynamic';

const DRIFT_COLOR: Record<string, string> = {
  stable: 'bg-primary/10 text-primary',
  warning: 'bg-amber-500/10 text-amber-600',
  drift: 'bg-destructive/10 text-destructive',
};

const STATUS_COLOR: Record<string, string> = {
  done: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
  denied: 'bg-destructive/10 text-destructive',
};

function verdictBadge(verdict: string): string {
  if (verdict === 'pass' || verdict === 'ok') return 'bg-primary/10 text-primary';
  if (verdict === 'blocked' || verdict === 'fail') return 'bg-destructive/10 text-destructive';
  return 'bg-amber-500/10 text-amber-600';
}

function onlineState(configured: boolean, enabled: boolean): string {
  if (!configured) return 'local';
  return enabled ? 'live' : 'paused';
}

type Trace = Awaited<ReturnType<typeof listAgentRuns>>[number];
type Eval = Awaited<ReturnType<typeof listEvalRuns>>[number];

// Offline eval-run history — each row drills into per-case pass/fail detail.
function EvalRunsCard({ evals }: { evals: Eval[] }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Eval runs</CardTitle>
        <p className="text-xs text-muted-foreground">Golden-set runs — click for per-case results.</p>
      </CardHeader>
      <CardContent>
        {evals.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Passed</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {evals.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs text-foreground">{e.id}</TableCell>
                  <TableCell className="text-foreground">{e.score}%</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.passed}/{e.total}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {e.startedAt.slice(0, 16).replace('T', ' ')}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/observability/evals/${e.id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      detail →
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">No eval runs yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// Recent governed-pipeline runs — checks + provenance per interaction.
function RunTracesTable({ runs }: { runs: Trace[] }) {
  if (!runs.length) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No agent runs yet. Run an agent from the Agents screen.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Agent</TableHead>
          <TableHead>Query</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Checks</TableHead>
          <TableHead>Signed</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-mono text-xs text-foreground">{r.agentId}</TableCell>
            <TableCell className="max-w-xs truncate text-muted-foreground">{r.query}</TableCell>
            <TableCell>
              <Badge variant="secondary" className={STATUS_COLOR[r.status] ?? ''}>
                {r.status}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {r.checks.length ? (
                  r.checks.map((c, i) => (
                    <Badge key={i} variant="secondary" className={verdictBadge(c.verdict)}>
                      {c.name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </TableCell>
            <TableCell>
              {r.provenance ? (
                <Badge variant="outline">{r.provenance.algorithm}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              <Link
                href={`/agents/${r.agentId}/runs/${r.id}`}
                className="text-xs text-primary hover:underline"
              >
                trace →
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function ObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleForUser('observability');
  const org = await currentOrgId();
  const sp = await searchParams;
  const lfRangeRaw = Array.isArray(sp.lfRange) ? sp.lfRange[0] : sp.lfRange;
  const { range, fromIso, toIso } = resolveRange(lfRangeRaw);
  const [evals, drift, runs, onlineEnabled, traces, insights] = await Promise.all([
    listEvalRuns(20),
    getDrift().analyze(),
    listAgentRuns(15, org),
    getFlags().isEnabled('online-evals', true),
    safeListTraces(30),
    safeLangfuseInsights(fromIso, toIso),
  ]);

  const latest = evals[0];
  const trend = [...evals].reverse().map((r, i) => ({ label: `#${i + 1}`, score: r.score }));
  const online = scoringConfigured();

  // Live alert evaluation against the operator's console-owned threshold rules. Drift score is the
  // PSI metric (0..1-ish population stability index); eval pass-rate is the latest score as a fraction.
  const psi = drift.metrics.find((m) => m.name === 'score_psi')?.value ?? null;
  const alerts = await evaluateThresholdAlerts({
    driftScore: psi,
    evalPassRate: latest ? latest.score / 100 : null,
  }).catch(() => []);

  const stats = [
    {
      label: 'Latest eval score',
      value: latest ? `${latest.score}%` : '—',
      icon: CheckCircle,
    },
    { label: 'Drift status', value: drift.status, icon: Gauge },
    {
      label: 'Online scoring',
      value: onlineState(online, onlineEnabled),
      icon: Pulse,
    },
    { label: 'Traced runs', value: String(runs.length), icon: SealCheck },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Agent QA &amp; observability. Offline eval scores, drift (PSI), and the online
          LLM-as-judge — every agent run is traced through the governed pipeline with checks and
          tamper-evident provenance. Online scores stream to {online ? 'Langfuse' : 'the local store'}{' '}
          via the observability adapter.
        </p>
        <RunSweepButton />
      </div>

      {drift.status === 'drift' ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          Quality drift detected — {drift.note ?? 'eval scores are diverging from baseline.'}
        </div>
      ) : null}

      {alerts.map((a) => (
        <div
          key={`${a.metric}-${a.rule.op}-${a.rule.value}`}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
            a.severity === 'critical'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
          }`}
        >
          <AlertTriangle className="size-4" />
          Threshold breached — {a.message}
        </div>
      ))}

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
              <div className="text-2xl font-semibold capitalize text-foreground">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Eval score history</CardTitle>
            <p className="text-xs text-muted-foreground">
              Offline golden-set evals (engine: {getEvals().meta.id}). Newest on the right.
            </p>
          </CardHeader>
          <CardContent>
            {trend.length ? (
              <ScoreTrendChart data={trend} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No eval runs yet. Run a QA sweep to start the history.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Drift &amp; degradation</CardTitle>
            <p className="text-xs text-muted-foreground">
              Engine: {drift.engine} · {drift.baseline} baseline vs {drift.current} current samples.
            </p>
          </CardHeader>
          <CardContent>
            {drift.metrics.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drift.metrics.map((m) => (
                    <TableRow key={m.name}>
                      <TableCell className="font-mono text-xs text-foreground">{m.name}</TableCell>
                      <TableCell className="text-foreground">{m.value}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={DRIFT_COLOR[m.status] ?? ''}>
                          {m.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Not enough samples to assess drift yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <ThresholdManager />

      <LangfuseInsightsPanel
        configured={insights.configured}
        cost={insights.cost}
        trends={insights.trends}
        error={insights.error}
        range={range}
      />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Langfuse traces</CardTitle>
          <p className="text-xs text-muted-foreground">
            LLM traces read back from Langfuse&apos;s public API — expand a trace for its span
            waterfall. Spans are pushed via the OTLP observability seam.
          </p>
        </CardHeader>
        <CardContent>
          <LangfuseTraces
            configured={traces.configured}
            traces={traces.traces}
            error={traces.error}
          />
        </CardContent>
      </Card>

      <EvalRunsCard evals={evals} />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Recent agent run traces</CardTitle>
          <p className="text-xs text-muted-foreground">
            Every interaction through the governed pipeline — checks, grounding, and provenance per
            run.
          </p>
        </CardHeader>
        <CardContent>
          <RunTracesTable runs={runs} />
        </CardContent>
      </Card>
    </div>
  );
}
