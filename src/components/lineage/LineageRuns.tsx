import { ArrowRight, FileText, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import type { AgentRun } from '@/lib/agentrun';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function LineageRuns({ runs }: Readonly<{ runs: AgentRun[] }>) {
  const withSources = runs.filter((run) => run.citations.length > 0);

  if (!withSources.length) {
    return (
      <Card className="shadow-sm">
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          No run lineage yet. Run a grounded agent and its source-to-answer edges appear here.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full space-y-4">
      {withSources.map((run) => (
        <Card key={run.id} className="shadow-sm">
          <CardHeader className="space-y-0 pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <TreeStructure className="size-5 text-primary" />
                <CardTitle className="text-sm">{run.agentId}</CardTitle>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {run.id}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  Sources ({run.citations.length})
                </span>
                <div className="space-y-1">
                  {run.citations.map((citation) => (
                    <div
                      key={citation.ref}
                      className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-xs text-foreground">{citation.title}</span>
                      {citation.supported ? (
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
                  Answer{run.provenance ? ` · signed ${run.provenance.algorithm}` : ''}
                </span>
                <div className="rounded-md bg-muted/50 p-2.5 text-xs text-foreground">
                  <p className="mb-1 text-muted-foreground">{run.query}</p>
                  {run.answer.slice(0, 240) || '-'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
