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
import { LangfuseRegistryPanel } from '@/components/observability/LangfuseRegistryPanel';
import { LangfuseTraces } from '@/components/observability/LangfuseTraces';
import { RunSweepButton } from '@/components/observability/RunSweepButton';
import { ThresholdManager } from '@/components/observability/ThresholdManager';
import { PipelineFacetSelect } from '@/components/pipelines/PipelineFacetSelect';
import { Badge } from '@/components/ui/badge';
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
import { getDrift, getEvals, getFlags } from '@/lib/adapters/registry';
import type { DriftReport } from '@/lib/adapters/types';
import { listAgentRuns } from '@/lib/agentrun';
import { listEvalRuns } from '@/lib/evals';
import {
  resolveRange,
  safeLangfuseInsights,
  safeLangfuseRegistry,
  safeListTraces,
} from '@/lib/langfuse';
import { resolveRegistryTab } from '@/lib/langfuse-registry';
import { requireModuleForUser } from '@/lib/module-access';
import { evaluateThresholdAlerts } from '@/lib/observability-settings';
import { listPipelines } from '@/lib/pipelines';
import { resolvePipelineFacet } from '@/lib/pipelines-policy';
import { scoringConfigured } from '@/lib/qa/scoring';
import { currentOrgId } from '@/lib/tenancy';
import { withTimeout } from '@/lib/with-timeout';

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
function EvalRunsCard({ evals }: Readonly<{ evals: Eval[] }>) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm">Eval runs</CardTitle>
        <p className="text-xs text-muted-foreground">
          Golden-set runs — click for per-case results.
        </p>
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
                      href={`/insights/evals/${e.id}`}
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
function RunTracesTable({ runs }: Readonly<{ runs: Trace[] }>) {
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
                href={`/solutions/agents/${r.agentId}/runs/${r.id}`}
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
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  await requireModuleForUser('observability');
  const org = await currentOrgId();
  const sp = await searchParams;
  const lfRangeRaw = Array.isArray(sp.lfRange) ? sp.lfRange[0] : sp.lfRange;
  const lfRegRaw = Array.isArray(sp.lfReg) ? sp.lfReg[0] : sp.lfReg;
  const regTab = resolveRegistryTab(lfRegRaw);
  const { range, fromIso, toIso } = resolveRange(lfRangeRaw);
  // Pipeline facet — eval-run history filters server-side (eval_runs carry pipeline_id, PA-12); the
  // other probes aren't pipeline-aware yet, so the note by the control is explicit about the scope.
  const pipelines = await listPipelines(org).catch(() => []);
  const facet = resolvePipelineFacet(
    sp.pipeline,
    pipelines.map((p) => p.id),
  );
  const facetName = facet ? (pipelines.find((p) => p.id === facet)?.name ?? facet) : null;
  // Every probe runs in parallel AND under a wall-clock ceiling: the observability page fans out to
  // eval history, the drift engine (Evidently), durable runs, feature flags, and three Langfuse
  // calls. The Langfuse trio already degrade gracefully; here we also cap eval/drift/runs/flag reads
  // so a slow or wedged backend degrades to an empty tile instead of stalling the whole page past
  // the "instant" bar. The loading.tsx skeleton covers the render up to this ceiling.
  const PROBE_MS = 1500;
  const DRIFT_FALLBACK: DriftReport = {
    engine: 'unavailable',
    status: 'stable',
    metrics: [],
    baseline: 0,
    current: 0,
    note: 'Drift engine did not respond in time.',
  };
  const [evals, drift, runs, onlineEnabled, traces, insights, registry] = await Promise.all([
    withTimeout(listEvalRuns(20, org, facet), PROBE_MS, []),
    withTimeout(getDrift().analyze({ orgId: org }), PROBE_MS, DRIFT_FALLBACK),
    withTimeout(listAgentRuns(15, org), PROBE_MS, []),
    withTimeout(getFlags().isEnabled('online-evals', true), PROBE_MS, true),
    safeListTraces(30),
    safeLangfuseInsights(fromIso, toIso),
    safeLangfuseRegistry(50),
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
          tamper-evident provenance. Online scores stream to the tracing store via the observability
          adapter.
          {facetName ? (
            <span className="text-foreground">
              {' '}
              Eval runs filtered to pipeline “{facetName}”; other panels show all pipelines.
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-3">
          <PipelineFacetSelect pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))} />
          <RunSweepButton />
        </div>
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

      <StatRail>
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
      </StatRail>

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

      <LangfuseRegistryPanel
        configured={registry.configured}
        prompts={registry.prompts}
        datasets={registry.datasets}
        sessions={registry.sessions}
        error={registry.error}
        tab={regTab}
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
