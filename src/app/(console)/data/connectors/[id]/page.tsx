import { ArrowLeft, ArrowRight, Database } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConnectorActions } from '@/components/data/ConnectorActions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getConnectorDetail } from '@/lib/connector-detail';
import { requireModuleForUser } from '@/lib/module-access';
import { listPipelinesByDomains } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
  connected: 'bg-primary/10 text-primary',
  completed: 'bg-primary/10 text-primary',
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-amber-500/10 text-amber-600',
  error: 'bg-destructive/10 text-destructive',
  failed: 'bg-destructive/10 text-destructive',
};

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

// Connector DETAIL — the deep view behind one connector: its config, the resolved live-query
// dialect, the data-domains routing to it, and its sync history. Reached by clicking a connector
// on the Data page (URL-driven, deep-linkable). All actions (sync/edit/delete) live on the row's
// action menu, reused here so the operator can run + maintain the connector from its own page.
export default async function ConnectorDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('data');
  const { id } = await params;
  const org = await currentOrgId();
  const detail = await getConnectorDetail(id, org);
  if (!detail) notFound();
  const { connector: c, dialect, syncHistory, boundDomains } = detail;

  // Reverse edge: a connector is reached by a pipeline TRANSITIVELY through the domains bound to it.
  // A pipeline references this connector when its data ceiling allowlists any of those domains.
  const referencedByPipelines = (
    await listPipelinesByDomains(
      boundDomains.map((d) => ({ id: d.id, label: d.label, aliases: d.aliases })),
      org,
    ).catch(() => [])
  ).map((p) => ({ id: p.id, name: p.name, status: p.status }));

  return (
    <PageFrame>
      {
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Database className="size-5" />
              </div>
              <div>
                <Link
                  href="/data"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-3" /> Connectors
                </Link>
                <h1 className="mt-1 text-lg font-semibold text-foreground">{c.name}</h1>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="secondary" className={STATUS[c.status] ?? 'bg-muted'}>
                    {c.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{c.type}</span>
                  {c.custom ? (
                    <Badge variant="outline" className="text-[10px]">
                      custom
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="shrink-0">
              <ConnectorActions id={c.id} name={c.name} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm">Configuration</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Type">{c.type}</Field>
                <Field label="Auth">{c.auth}</Field>
                <Field label="Last sync">
                  {c.lastSync ? c.lastSync.slice(0, 19).replace('T', ' ') : 'never'}
                </Field>
                <Field label="Live-query dialect">
                  {dialect ? (
                    <Badge variant="secondary" className="bg-primary/10 text-primary">
                      {dialect}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">not a live-query source</span>
                  )}
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Endpoint">
                    <code className="break-all font-mono text-xs text-muted-foreground">
                      {c.endpoint || '—'}
                    </code>
                  </Field>
                </div>
                {c.description ? (
                  <div className="sm:col-span-2">
                    <Field label="Description">
                      <span className="text-sm text-muted-foreground">{c.description}</span>
                    </Field>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm">Bound data domains</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Rules that route a phrase to this connector by resource. Manage them on the{' '}
                  <Link href="/data/domains" className="text-primary hover:underline">
                    data domains
                  </Link>{' '}
                  page.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {boundDomains.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No data domains route to this connector yet.
                  </p>
                ) : (
                  boundDomains.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{d.label}</span>
                        {d.aliases.length > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {d.aliases.join(', ')}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                        <code className="truncate font-mono text-muted-foreground">
                          {d.resource}
                        </code>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">Sync history</CardTitle>
              <p className="text-xs text-muted-foreground">
                Ingest runs for this connector, most recent first.
              </p>
            </CardHeader>
            <CardContent>
              {syncHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No sync runs yet. Use the actions menu to trigger a sync.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Started</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Records</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncHistory.map((j) => (
                        <TableRow key={j.id}>
                          <TableCell className="text-muted-foreground">
                            {j.startedAt.slice(0, 19).replace('T', ' ')}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={STATUS[j.status] ?? 'bg-muted'}>
                              {j.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {j.records.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reverse edge — pipelines that reach this connector through its bound domains. Mirrors the
          "Bound data domains" card above, closing the loop: substrate legible from both ends. */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm">
                Referenced by pipelines ({referencedByPipelines.length})
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Pipelines whose data ceiling allowlists a domain that routes to this connector — the
                governed consumers permitted to read from it.
              </p>
            </CardHeader>
            <CardContent>
              {referencedByPipelines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pipeline references this connector yet — no governed consumer can reach its
                  data until a pipeline allowlists one of its domains.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {referencedByPipelines.map((p) => (
                    <Link key={p.id} href={`/runtime/pipelines/${p.id}`}>
                      <Badge
                        variant="outline"
                        className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                      >
                        {p.name}
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {p.status}
                        </span>
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      }
    </PageFrame>
  );
}
