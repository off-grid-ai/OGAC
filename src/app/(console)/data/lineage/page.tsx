import {
  ArrowRight,
  Database,
  FileText,
  Stack,
  TreeStructure,
} from '@phosphor-icons/react/dist/ssr';
import { DatasetDetailPanel } from '@/components/lineage/DatasetDetailPanel';
import { LineageCurate } from '@/components/lineage/LineageCurate';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listAgentRuns } from '@/lib/agentrun';
import { readLineageView } from '@/lib/marquez';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function LineagePage() {
  await requireModuleForUser('lineage');
  const org = await currentOrgId();
  // Degrade gracefully: readLineageView() never throws (returns {configured,error}); guard the
  // sibling DB call so Postgres being down renders a partial page (empty runs) not the error boundary.
  const [runs, lineage] = await Promise.all([
    listAgentRuns(25, org).catch(() => []),
    readLineageView(),
  ]);
  const withSources = runs.filter((r) => r.citations.length > 0);
  const { configured, data, error } = lineage;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Data lineage for every agent run — which sources fed which answer, end to end. Each run
          records a lineage event; the graph below is read back from the lineage store, with a
          fallback reconstruction from recorded source→answer edges.
        </p>
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          Data lineage
        </Badge>
      </div>

      {/* Lineage store read-back — the server-sourced namespaces / jobs / datasets model. */}
      {!configured ? (
        <Card className="shadow-sm">
          <CardContent className="py-8 text-center text-xs text-muted-foreground">
            Lineage store not configured — configure the lineage service to read the server lineage
            graph.
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="shadow-sm">
          <CardContent className="py-8 text-center text-xs text-destructive">
            Lineage store unreachable: {error}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Data lineage</CardTitle>
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                {data.namespace ?? '—'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {data.counts.namespaces} namespace(s) · {data.counts.jobs} job(s) ·{' '}
              {data.counts.datasets} dataset(s) · {data.counts.edges} edge(s)
              {data.lastRun ? ` · last run ${data.lastRun}` : ''} — read back from the lineage store.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {!data.jobs.length && !data.datasets.length ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No lineage in namespace {data.namespace ?? '—'} yet. Run a grounded agent to emit
                lineage events.
              </p>
            ) : (
              data.jobs.map((j) => (
                <div
                  key={j.name}
                  className="grid grid-cols-1 items-center gap-2 lg:grid-cols-[1fr_auto_1fr]"
                >
                  <div className="space-y-1">
                    {j.inputs.length ? (
                      j.inputs.map((i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1"
                        >
                          <Database className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-xs text-foreground">{i}</span>
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
                    <Badge variant="outline" className="gap-1">
                      <TreeStructure className="size-3" />
                      {j.name}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {j.lastRunState}
                    </Badge>
                    <ArrowRight className="hidden size-4 text-muted-foreground lg:block" />
                  </div>
                  <div className="space-y-1">
                    {j.outputs.length ? (
                      j.outputs.map((o) => (
                        <div
                          key={o}
                          className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1"
                        >
                          <Database className="size-3.5 shrink-0 text-primary" />
                          <span className="truncate text-xs text-foreground">{o}</span>
                        </div>
                      ))
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                        no outputs
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
            {data.namespaces.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                <Stack className="size-3.5 text-muted-foreground" />
                {data.namespaces.map((n) => (
                  <Badge
                    key={n}
                    variant={n === data.namespace ? 'secondary' : 'outline'}
                    className="text-[10px]"
                  >
                    {n}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {configured && !error ? (
        <>
          <LineageCurate
            namespaces={data.namespaces}
            datasets={data.datasets.map((d) => d.name)}
            jobs={data.jobs.map((j) => j.name)}
            activeNamespace={data.namespace}
          />
          {/* URL-driven (?dataset=) detail panel — schema / facets / tags for one dataset. */}
          <DatasetDetailPanel namespace={data.namespace} />
        </>
      ) : null}

      {withSources.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No lineage yet. Run a grounded agent and its source→answer edges appear here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {withSources.map((r) => (
            <Card key={r.id} className="shadow-sm">
              <CardHeader className="space-y-0 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <TreeStructure className="size-5 text-primary" />
                    <CardTitle className="text-sm">{r.agentId}</CardTitle>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                    {r.id}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Sources ({r.citations.length})
                    </span>
                    <div className="space-y-1">
                      {r.citations.map((c) => (
                        <div
                          key={c.ref}
                          className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
                        >
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-xs text-foreground">{c.title}</span>
                          {c.supported ? (
                            <Badge
                              variant="secondary"
                              className="ml-auto shrink-0 bg-primary/10 text-primary"
                            >
                              cited
                            </Badge>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <ArrowRight className="mx-auto hidden size-5 text-muted-foreground lg:block" />

                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      Answer{r.provenance ? ` · signed ${r.provenance.algorithm}` : ''}
                    </span>
                    <div className="rounded-md bg-muted/50 p-2.5 text-xs text-foreground">
                      <p className="mb-1 text-muted-foreground">{r.query}</p>
                      {r.answer.slice(0, 240) || '—'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
