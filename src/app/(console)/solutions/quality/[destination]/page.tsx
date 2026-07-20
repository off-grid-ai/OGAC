import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EvalsWorkbench } from '@/components/evals/EvalsWorkbench';
import { GoldenCasesManager } from '@/components/evals/GoldenCasesManager';
import { QualityExecutionHistory } from '@/components/evals/QualityExecutionHistory';
import { RunEvalSuiteButton } from '@/components/evals/RunEvalSuiteButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { evalEngineLabel } from '@/lib/eval-engine-label';
import { listGoldenCases } from '@/lib/evals';
import { isRunnableEngine, RUNNABLE_ENGINES } from '@/lib/evals-golden';
import { readEvalsView, type EvalRunView, type EvalsView } from '@/lib/evals-view';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelines } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';
import { contextualDestinationForPath, contextualModule } from '@/modules/contextual-navigation';

export const dynamic = 'force-dynamic';

export default async function QualityDestinationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ destination: string }>;
  searchParams: Promise<{ suite?: string }>;
}>) {
  await requireModuleForUser('evals');
  const { destination: rawDestination } = await params;
  const module = contextualModule('solutions-quality');
  const destination = contextualDestinationForPath(module, `${module.baseRoute}/${rawDestination}`);
  if (!destination) notFound();

  if (destination.id === 'evaluators') return <EvalsWorkbench />;

  const org = await currentOrgId();
  if (destination.id === 'golden-cases') {
    const [goldenCases, pipelines] = await Promise.all([
      listGoldenCases().catch(() => []),
      listPipelines(org).catch(() => []),
    ]);
    const nameById = new Map(pipelines.map((pipeline) => [pipeline.id, pipeline.name]));
    const boundPipelines = [
      ...new Set(
        goldenCases.map((goldenCase) => goldenCase.pipelineId).filter((id): id is string => !!id),
      ),
    ]
      .map((id) => ({ id, name: nameById.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return <GoldenCasesDestination boundPipelines={boundPipelines} />;
  }

  const view = await readEvalsView(25, org);
  const { suite } = await searchParams;
  const activeSuite = suite && view.suites.some((item) => item.engine === suite) ? suite : null;
  const runs = activeSuite
    ? view.recentRuns.filter((run) => run.engine === activeSuite)
    : view.recentRuns;
  return <RunsDestination view={view} runs={runs} activeSuite={activeSuite} />;
}

function GoldenCasesDestination({
  boundPipelines,
}: Readonly<{ boundPipelines: { id: string; name: string }[] }>) {
  return (
    <div className="space-y-6">
      <GoldenCasesManager />
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Used by pipelines ({boundPipelines.length})</CardTitle>
          <CardDescription className="text-xs">
            Pipeline-bound cases run in that pipeline&apos;s context. Org-wide cases remain reusable
            across Apps.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {boundPipelines.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No pipeline has a golden set yet. Attach cases from a pipeline&apos;s Quality view.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {boundPipelines.map((pipeline) => (
                <Link key={pipeline.id} href={`/runtime/pipelines/${pipeline.id}/quality`}>
                  <Badge
                    variant="outline"
                    className="border-primary/40 text-primary hover:bg-primary/10"
                  >
                    {pipeline.name}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RunsDestination({
  view,
  runs,
  activeSuite,
}: Readonly<{
  view: EvalsView;
  runs: EvalsView['recentRuns'];
  activeSuite: string | null;
}>) {
  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-sm">Launch an execution</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Run the current golden set with the selected evaluator.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {RUNNABLE_ENGINES.map((engine) => (
              <RunEvalSuiteButton
                key={engine}
                engine={engine}
                variant={engine === 'golden' ? 'default' : 'outline'}
                disabled={view.goldenCases === 0}
              />
            ))}
          </div>
        </CardHeader>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Execution filters</CardTitle>
          <CardDescription className="text-xs">
            Each execution opens an immutable scorecard. Trends, drift, and release gates stay in{' '}
            <Link href="/solutions/quality/performance" className="text-primary hover:underline">
              this Quality workspace
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view.suites.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No eval runs yet. Run an evaluator or a golden suite to create one.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Link href="/solutions/quality/runs">
                <Badge variant={activeSuite === null ? 'secondary' : 'outline'}>All</Badge>
              </Link>
              {view.suites.map((suite) => (
                <Link
                  key={suite.engine}
                  href={`/solutions/quality/runs?suite=${encodeURIComponent(suite.engine)}`}
                >
                  <Badge
                    variant={activeSuite === suite.engine ? 'secondary' : 'outline'}
                    className="gap-1.5"
                  >
                    {evalEngineLabel(suite.engine)} · {suite.runs}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Recent executions{activeSuite ? ` · ${evalEngineLabel(activeSuite)}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No runs.</p>
          ) : (
            <QualityExecutionHistory runs={runs} actionsFor={(run) => <RunActions run={run} />} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RunActions({ run }: Readonly<{ run: EvalRunView }>) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isRunnableEngine(run.engine) ? (
        <RunEvalSuiteButton engine={run.engine} label="Re-run" />
      ) : null}
      <Link
        href={`/solutions/quality/runs/${encodeURIComponent(run.id)}`}
        className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        View run
      </Link>
    </div>
  );
}
