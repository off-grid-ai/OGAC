import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RunEvalSuiteButton } from '@/components/evals/RunEvalSuiteButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { evalEngineLabel } from '@/lib/eval-engine-label';
import { getEvalRun } from '@/lib/evals';
import { describeRagasAttribution } from '@/lib/ragas-run';
import { isRunnableEngine } from '@/lib/evals-golden';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function QualityExecutionDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('evals');
  const { id } = await params;
  const run = await getEvalRun(id, await currentOrgId());
  if (!run) notFound();
  const cases = run.results ?? [];

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Link
            href="/solutions/quality/runs"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Executions
          </Link>
          <div>
            <h3 className="font-mono text-lg font-medium">{run.id}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {evalEngineLabel(run.engine)} - {run.startedAt.slice(0, 19).replace('T', ' ')}
            </p>
          </div>
        </div>
        {isRunnableEngine(run.engine) ? (
          <RunEvalSuiteButton engine={run.engine} label="Re-run" />
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Score">
          <div className="text-2xl font-medium">{run.score}%</div>
          <Progress value={run.score} className="mt-3" />
        </Metric>
        <Metric label="Passed">
          <div className="text-2xl font-medium">{run.passed}</div>
        </Metric>
        <Metric label="Failed">
          <div className="text-2xl font-medium">{Math.max(0, run.total - run.passed)}</div>
        </Metric>
        <Metric label="Pipeline">
          {run.pipelineId ? (
            <Link
              href={`/runtime/pipelines/${run.pipelineId}/quality`}
              className="text-sm text-primary hover:underline"
            >
              {run.pipelineId}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">Org-wide</span>
          )}
        </Metric>
      </div>

      {run.attribution ? <EngineAttribution attribution={run.attribution} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Per-case results</CardTitle>
          <p className="text-xs text-muted-foreground">
            The execution record is immutable. Fix a failing golden case or evaluator, then re-run
            the suite.
          </p>
        </CardHeader>
        <CardContent>
          {cases.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              This evaluator recorded an aggregate score only. Per-case evidence is unavailable for
              this run.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Input</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Observed top hit</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">Verdict</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.map((testCase, index) => (
                    <TableRow key={`${testCase.query}-${index}`}>
                      <TableCell className="max-w-xs whitespace-normal">{testCase.query}</TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                        {testCase.expected}
                      </TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                        {testCase.top}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {testCase.score}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="secondary"
                          className={
                            testCase.pass
                              ? 'bg-primary/10 text-primary'
                              : 'bg-destructive/10 text-destructive'
                          }
                        >
                          {testCase.pass ? 'pass' : 'fail'}
                        </Badge>
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
  );
}

function Metric({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// The retained engine-attribution card — proves HOW an engine-scored run (e.g. Ragas) was produced:
// the engine + version, the governed judge chain (agent→pipeline→gateway→model), and exactly which
// metrics the engine returned vs omitted. Renders only for runs that carry an attribution blob.
function EngineAttribution({
  attribution,
}: Readonly<{ attribution: Record<string, unknown> }>) {
  const v = describeRagasAttribution(attribution);
  if (!v) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm">Engine attribution</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={v.engineProven ? 'default' : 'destructive'}>
              {v.engineProven ? 'Engine path proven' : 'Engine path unproven'}
            </Badge>
            {v.degraded ? <Badge variant="outline">Degraded</Badge> : null}
            <Badge variant={v.judgeConformant ? 'default' : 'destructive'}>
              {v.judgeConformant ? 'Governed judge' : 'Bootstrap judge'}
            </Badge>
          </div>
        </div>
        {v.note ? <p className="text-xs text-muted-foreground">{v.note}</p> : null}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AttrField label="Engine" value={`${v.engine} ${v.ragasVersion}`} />
          <AttrField label="Sidecar" value={v.sidecarService} />
          <AttrField label="Judge model" value={v.judgeModel} />
          <AttrField label="Gateway" value={v.gatewayId ?? '—'} />
          <AttrField label="Judge agent" value={v.agentId ?? '—'} />
          <AttrField label="Judge pipeline" value={v.pipelineId ?? '—'} />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Metrics returned
          </p>
          {v.metrics.length === 0 ? (
            <p className="text-xs text-muted-foreground">The engine returned no metric scores.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {v.metrics.map((m) => (
                <div
                  key={m.name}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="font-mono text-xs">{m.name}</span>
                  <span className="font-mono text-sm font-medium">{m.pct}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {v.omitted.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Metrics omitted (engine could not compute)
            </p>
            <div className="flex flex-wrap gap-2">
              {v.omitted.map((m) => (
                <Badge key={m} variant="outline" className="font-mono">
                  {m}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AttrField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-all font-mono text-xs">{value}</p>
    </div>
  );
}
