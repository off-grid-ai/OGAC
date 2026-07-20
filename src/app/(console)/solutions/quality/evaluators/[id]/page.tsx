import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EvalDefinitionActions } from '@/components/evals/QualityEntityActions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { evalEngineLabel } from '@/lib/eval-engine-label';
import { getEvalDef } from '@/lib/eval-defs';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function EvaluatorDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('evals');
  const { id } = await params;
  const definition = await getEvalDef(id, await currentOrgId());
  if (!definition) notFound();

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Link
            href="/solutions/quality/evaluators"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Evaluators
          </Link>
          <div>
            <h3 className="text-lg font-medium">{definition.name}</h3>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              {definition.description || 'No description recorded.'}
            </p>
          </div>
        </div>
        <EvalDefinitionActions definition={definition} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label="Checker">
          <Badge variant="outline">{evalEngineLabel(definition.engine)}</Badge>
        </Fact>
        <Fact label="Metric">
          <span className="font-mono text-sm">{definition.metric}</span>
        </Fact>
        <Fact label="Pass threshold">
          <span className="text-xl">
            {definition.direction === 'higher-better' ? '>=' : '<='}{' '}
            {Math.round(definition.threshold * 100)}%
          </span>
        </Fact>
        <Fact label="Golden suite">
          <Badge variant="secondary">{definition.suite}</Badge>
        </Fact>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Release ownership</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {definition.pipelineId ? (
            <p>
              This evaluator gates{' '}
              <Link
                className="text-primary hover:underline"
                href={`/runtime/pipelines/${definition.pipelineId}/quality`}
              >
                pipeline {definition.pipelineId}
              </Link>
              . Run it here for a scorecard or publish through the pipeline Quality view for a
              persisted release-gate decision.
            </p>
          ) : (
            <p>
              This is an org-wide evaluator. Attach it to a pipeline before it can block a release.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
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
