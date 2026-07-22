import { ArrowLeft, LockKey } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { KestraKvManager } from '@/components/orchestration/KestraKvManager';
import { PageFrame } from '@/components/PageFrame';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { kestraCatalog } from '@/lib/adapters/kestra-catalog';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Namespace detail — its secret keys (read-only; values never shown) and its writable key/value
// store (full CRUD via KestraKvManager). Full-width, two-column on wide screens.
export default async function NamespaceDetailPage({
  params,
}: Readonly<{ params: Promise<{ ns: string }> }>) {
  await requireModuleForUser('data');
  const { ns: rawNs } = await params;
  const ns = decodeURIComponent(rawNs);

  const namespace = await kestraCatalog.getNamespace(ns);
  if (!namespace) notFound();

  const [secrets, kv] = await Promise.all([
    kestraCatalog.listSecrets(ns),
    kestraCatalog.listKv(ns),
  ]);

  return (
    <PageFrame embedded>
      <div className="w-full space-y-6">
        <div className="space-y-3">
          <Link
            href="/data/flows/orchestration/namespaces"
            className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Namespaces
          </Link>
          <h1 className="font-mono text-lg font-semibold">{namespace.id}</h1>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
                <LockKey className="size-4" /> Secret keys
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
                  {secrets.keys.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {secrets.readOnly
                  ? 'Secrets are managed in the engine deployment config and are read-only here. Values are never shown.'
                  : 'Secret keys registered for this namespace. Values are never shown.'}
              </p>
              {secrets.keys.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  No secret keys in this namespace.
                </p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-md border border-border">
                  {secrets.keys.map((k) => (
                    <li key={k} className="flex items-center gap-2 px-3 py-2 font-mono text-sm">
                      <LockKey className="size-3.5 text-muted-foreground" />
                      {k}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <KestraKvManager namespace={ns} rows={kv} />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageFrame>
  );
}
