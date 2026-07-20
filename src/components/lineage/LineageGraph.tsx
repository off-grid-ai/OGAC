import { ArrowRight, Database, Stack, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { LineageGraphCuration } from '@/components/lineage/LineageCurate';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { lineageNodeLabel, type LineageView } from '@/lib/lineage-view';

interface Props {
  configured: boolean;
  data: LineageView;
  error: string | null;
}

export function LineageStoreUnavailable({ error }: Readonly<{ error: string | null }>) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <Badge variant={error ? 'destructive' : 'secondary'}>
          {error ? 'Unavailable' : 'Not configured'}
        </Badge>
        <p className="max-w-2xl text-xs text-muted-foreground">
          {error
            ? `The lineage store could not be read: ${error}`
            : 'Configure the Marquez lineage store to inspect jobs, datasets, and stored edges.'}
        </p>
      </CardContent>
    </Card>
  );
}

export function LineageGraph({ configured, data, error }: Readonly<Props>) {
  if (!configured || error) return <LineageStoreUnavailable error={error} />;

  let jobsBody: ReactNode;
  if (!data.jobs.length && !data.datasets.length) {
    jobsBody = (
      <p className="py-4 text-center text-xs text-muted-foreground">
        No lineage in namespace {data.namespace ?? '-'} yet. Run a grounded agent to emit lineage
        events.
      </p>
    );
  } else {
    jobsBody = data.jobs.map((job) => (
      <div
        key={job.name}
        className="grid grid-cols-1 items-center gap-2 lg:grid-cols-[1fr_auto_1fr]"
      >
        <div className="space-y-1">
          {job.inputs.length ? (
            job.inputs.map((input) => (
              <div
                key={input}
                className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1"
              >
                <Database className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs text-foreground" title={input}>
                  {lineageNodeLabel(input)}
                </span>
              </div>
            ))
          ) : (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
              no inputs
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowRight className="hidden size-4 text-muted-foreground lg:block" />
          <Badge variant="outline" className="gap-1" title={job.name}>
            <TreeStructure className="size-3" />
            {lineageNodeLabel(job.name)}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {job.lastRunState}
          </Badge>
          <ArrowRight className="hidden size-4 text-muted-foreground lg:block" />
        </div>
        <div className="space-y-1">
          {job.outputs.length ? (
            job.outputs.map((output) => (
              <div
                key={output}
                className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1"
              >
                <Database className="size-3.5 shrink-0 text-primary" />
                <span className="truncate text-xs text-foreground" title={output}>
                  {lineageNodeLabel(output)}
                </span>
              </div>
            ))
          ) : (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
              no outputs
            </span>
          )}
        </div>
      </div>
    ));
  }

  return (
    <div className="w-full space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Stored edges</CardTitle>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {data.namespace ?? '-'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {data.counts.namespaces} namespace(s) · {data.counts.jobs} job(s) ·{' '}
            {data.counts.datasets} dataset(s) · {data.counts.edges} edge(s)
            {data.lastRun ? ` · last run ${data.lastRun}` : ''}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {jobsBody}
          {data.namespaces.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
              <Stack className="size-3.5 text-muted-foreground" />
              {data.namespaces.map((namespace) => (
                <Badge
                  key={namespace}
                  variant={namespace === data.namespace ? 'secondary' : 'outline'}
                  className="text-[10px]"
                >
                  {namespace}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <LineageGraphCuration
        namespaces={data.namespaces}
        jobs={data.jobs.map((job) => job.name)}
        activeNamespace={data.namespace}
      />
    </div>
  );
}
