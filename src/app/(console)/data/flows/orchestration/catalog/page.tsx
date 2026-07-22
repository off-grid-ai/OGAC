import { Lightning, Plugs, PuzzlePiece } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { KestraCatalogSearch } from '@/components/orchestration/KestraCatalogSearch';
import { PageFrame } from '@/components/PageFrame';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { filterPluginGroups, summarizePluginCatalog } from '@/lib/kestra-catalog';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Orchestration plugin catalog — the installed ecosystem of composable actions (send a Slack
// message, call an HTTP API, run dbt, load to S3…) an operator can wire into a governed flow or app
// step. Full-width grid, URL-driven search (?q=), list→detail (a plugin opens /catalog/[group]).
// Product language: "actions", "plugins" — the engine name never leaks into the UI.
export default async function OrchestrationCatalogPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ q?: string }> }>) {
  await requireModuleForUser('data');
  const { q = '' } = await searchParams;

  const all = await kestraCatalog.listPlugins();
  const groups = filterPluginGroups(all, q);
  const summary = summarizePluginCatalog(all);
  const configured = kestraCatalog.configured();

  return (
    <PageFrame embedded>
      <div className="w-full space-y-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 font-mono text-lg font-semibold">
                <Plugs className="size-5 text-primary" /> Action catalog
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Every action your workflows can take in real systems — messaging, APIs, databases,
                cloud storage, transforms and more. Open a plugin to see the actions it adds and what
                each one needs.
              </p>
            </div>
            <KestraCatalogSearch initial={q} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Plugins" value={summary.groups} icon={<PuzzlePiece className="size-4" />} />
            <StatTile label="Actions" value={summary.tasks} icon={<Lightning className="size-4" />} />
            <StatTile label="Triggers" value={summary.triggers} />
            <StatTile label="Conditions" value={summary.conditions} />
          </div>
        </header>

        {!configured && all.length === 0 ? (
          <EmptyState
            title="Orchestration engine not reachable"
            body="The workflow engine isn't wired to this console yet, or it's currently unreachable. Once it's connected, its installed plugins appear here."
          />
        ) : groups.length === 0 ? (
          <EmptyState
            title="No plugins match"
            body={q ? `Nothing matches "${q}". Clear the search to see the full catalog.` : 'No plugins are installed on the engine.'}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {groups.map((g) => (
              <Link
                key={g.group}
                href={`/data/flows/orchestration/catalog/${encodeURIComponent(g.group)}`}
                className="group block"
              >
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="truncate text-base">{g.title}</CardTitle>
                    <p className="truncate font-mono text-xs text-muted-foreground">{g.group}</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {g.taskCount > 0 && <Badge variant="secondary">{g.taskCount} actions</Badge>}
                      {g.triggerCount > 0 && (
                        <Badge variant="outline">{g.triggerCount} triggers</Badge>
                      )}
                      {g.conditionCount > 0 && (
                        <Badge variant="outline">{g.conditionCount} conditions</Badge>
                      )}
                    </div>
                    {g.categories.length > 0 && (
                      <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
                        {g.categories.join(' · ')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageFrame>
  );
}

function StatTile({
  label,
  value,
  icon,
}: Readonly<{ label: string; value: number; icon?: React.ReactNode }>) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function EmptyState({ title, body }: Readonly<{ title: string; body: string }>) {
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
      <p className="font-mono text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
