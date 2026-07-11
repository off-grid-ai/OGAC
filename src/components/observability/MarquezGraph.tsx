import { ArrowRight, Database, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LineageGraph } from '@/lib/marquez';

// Marquez-sourced lineage graph. Renders the server's job→dataset graph read back from Marquez's
// REST API — the ground-truth OpenLineage view, distinct from the audit-reconstructed edges below.
export function MarquezGraph({ graph }: Readonly<{ graph: LineageGraph }>) {
  if (!graph.configured) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-8 text-center text-xs text-muted-foreground">
          Lineage store not configured — configure the lineage service to read the server lineage
          graph.
        </CardContent>
      </Card>
    );
  }
  if (graph.error) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-8 text-center text-xs text-destructive">
          Lineage store error: {graph.error}
        </CardContent>
      </Card>
    );
  }
  if (!graph.jobs.length && !graph.datasets.length) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-8 text-center text-xs text-muted-foreground">
          No lineage in namespace {graph.namespace ?? '—'} yet. Run a grounded agent to emit
          lineage events.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Lineage graph</CardTitle>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {graph.namespace}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {graph.jobs.length} job(s) · {graph.datasets.length} dataset(s) · {graph.edges.length}{' '}
          edge(s) — read back from the lineage store.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {graph.jobs.map((j) => (
          <div
            key={j.name}
            className="grid grid-cols-1 items-center gap-2 lg:grid-cols-[1fr_auto_1fr]"
          >
            <div className="space-y-1">
              {(j.inputs ?? []).length ? (
                (j.inputs ?? []).map((i) => (
                  <div
                    key={i.name}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1"
                  >
                    <Database className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs text-foreground">{i.name}</span>
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
              <ArrowRight className="hidden size-4 text-muted-foreground lg:block" />
            </div>
            <div className="space-y-1">
              {(j.outputs ?? []).length ? (
                (j.outputs ?? []).map((o) => (
                  <div
                    key={o.name}
                    className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1"
                  >
                    <Database className="size-3.5 shrink-0 text-primary" />
                    <span className="truncate text-xs text-foreground">{o.name}</span>
                  </div>
                ))
              ) : (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                  no outputs
                </span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
