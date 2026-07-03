import { ArrowRight, FileText, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import { MarquezGraph } from '@/components/observability/MarquezGraph';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getLineage } from '@/lib/adapters/registry';
import { listAgentRuns } from '@/lib/agentrun';
import { fetchLineageGraph } from '@/lib/marquez';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function LineagePage() {
  await requireModuleForUser('lineage');
  const org = await currentOrgId();
  const [runs, graph] = await Promise.all([listAgentRuns(25, org), fetchLineageGraph()]);
  const engine = getLineage().meta;
  const withSources = runs.filter((r) => r.citations.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Data lineage for every agent run — which sources fed which answer, end to end. Each run
          emits an OpenLineage event through the lineage adapter ({engine.vendor}); the graph below
          is reconstructed from the recorded source→answer edges.
        </p>
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          {engine.id}
        </Badge>
      </div>

      <MarquezGraph graph={graph} />

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
