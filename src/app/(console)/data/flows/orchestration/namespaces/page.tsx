import { CaretRight, Folders } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { PageFrame } from '@/components/PageFrame';
import { Card, CardContent } from '@/components/ui/card';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Orchestration namespaces — the scopes that own flows, secret keys and KV config. Full-width grid,
// list→detail (a namespace opens /namespaces/[ns]). Read-only list on this engine; namespaces appear
// as flows/config land in them.
export default async function OrchestrationNamespacesPage() {
  await requireModuleForUser('data');
  const namespaces = await kestraCatalog.listNamespaces();
  const configured = kestraCatalog.configured();

  return (
    <PageFrame embedded>
      <div className="w-full space-y-6">
        <header>
          <h1 className="flex items-center gap-2 font-mono text-lg font-semibold">
            <Folders className="size-5 text-primary" /> Namespaces
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Scopes that group your workflows and the config/secret keys they read. Open one to manage
            its key/value store and review its secret keys.
          </p>
        </header>

        {namespaces.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
            <p className="font-mono text-sm font-semibold">
              {configured ? 'No namespaces yet' : 'Orchestration engine not reachable'}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              {configured
                ? 'Namespaces appear here once a workflow or config key is created in one.'
                : "The workflow engine isn't wired to this console yet, or it's currently unreachable."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {namespaces.map((n) => (
              <Link
                key={n.id}
                href={`/data/flows/orchestration/namespaces/${encodeURIComponent(n.id)}`}
                className="group block"
              >
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="flex items-center justify-between gap-2 px-4 py-4">
                    <span className="min-w-0 truncate font-mono text-sm">{n.id}</span>
                    <CaretRight className="size-4 shrink-0 text-muted-foreground" />
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
