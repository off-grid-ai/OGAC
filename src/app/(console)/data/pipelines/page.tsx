import { ArrowsLeftRight, Plus } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { DataPlaneHealthBand } from '@/components/data/DataPlaneHealthBand';
import { PipelineSyncButton } from '@/components/data/PipelineSyncButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { airbyteEtl } from '@/lib/adapters/airbyte';
import { formatRows } from '@/lib/dataplane-ui';
import type { EtlJobStatus } from '@/lib/etl-model';
import { requireModuleForUser } from '@/lib/module-access';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

const JOB_TONE: Record<EtlJobStatus, string> = {
  succeeded: 'bg-primary/10 text-primary',
  running: 'bg-amber-500/10 text-amber-600',
  pending: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

const CONN_TONE: Record<string, string> = {
  active: 'bg-primary/10 text-primary',
  inactive: 'bg-muted text-muted-foreground',
  deprecated: 'bg-destructive/10 text-destructive',
};

function whenLabel(epochSeconds?: number): string {
  if (!epochSeconds) return '—';
  const d = new Date(epochSeconds * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

// Data movement (Pipelines) — our "Glue/DMS" parity surface. Lists the configured pipelines that
// move source data into the warehouse, each with its last run status and a "Run sync" action, plus
// a recent-job history. Consumes the live ETL adapter directly. If no pipelines are configured yet
// (fresh instance), an HONEST empty state — never fabricated rows.
export async function PipelinesContent({
  embedded = false,
  showHeading = true,
}: Readonly<{ embedded?: boolean; showHeading?: boolean }> = {}) {
  await requireModuleForUser('data');

  const [healthy, connections] = await Promise.all([
    airbyteEtl.health(),
    airbyteEtl.listConnections(),
  ]);

  // Pull recent jobs per connection (best-effort; each degrades to []).
  const jobsByConn = new Map(
    await Promise.all(
      connections.map(
        async (c) => [c.connectionId, await airbyteEtl.listJobs(c.connectionId)] as const,
      ),
    ),
  );
  const allJobs = [...jobsByConn.values()]
    .flat()
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return (
    <PageFrame embedded={embedded}>
      {
        <div className="w-full space-y-6">
          {showHeading ? (
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ArrowsLeftRight className="size-4 text-primary" />
                  Data movement
                </h2>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  Pipelines move data from your sources into the warehouse. Trigger a sync on demand
                  and watch each run land — this is how fresh data gets in.
                </p>
              </div>
            </div>
          ) : null}

          {connections.length === 0 ? (
            <Card>
              <CardContent className="space-y-4 py-10 text-center text-sm text-muted-foreground">
                <p>
                  {healthy
                    ? 'No pipelines have been configured yet. A pipeline connects a source (a database, a SaaS app, a file drop) to your warehouse and keeps it in sync.'
                    : "The data-movement engine isn't reachable right now, so pipelines can't be listed. Check the engine-health band below — pipelines appear here once it's back online."}
                </p>
                {healthy ? (
                  <Button asChild variant="outline" size="sm" className="mx-auto">
                    <Link href="/data/integrations">
                      <Plus className="size-4" />
                      Configure a pipeline
                    </Link>
                  </Button>
                ) : null}
                <div className="pt-2">
                  <DataPlaneHealthBand />
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {connections.map((c) => {
                  const jobs = jobsByConn.get(c.connectionId) ?? [];
                  const last = jobs[0];
                  return (
                    <Card key={c.connectionId} className="shadow-sm">
                      <CardHeader className="space-y-0 pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-sm">{c.name}</CardTitle>
                          <Badge
                            className={CONN_TONE[c.status] ?? 'bg-muted text-muted-foreground'}
                          >
                            {c.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {c.schedule ? `Schedule: ${c.schedule}` : 'Manual sync'}
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-3 text-xs">
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>Last run</span>
                          {last ? (
                            <Badge className={JOB_TONE[last.status]}>{last.status}</Badge>
                          ) : (
                            <span>never</span>
                          )}
                        </div>
                        <PipelineSyncButton connectionId={c.connectionId} name={c.name} />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Recent runs</CardTitle>
                </CardHeader>
                <CardContent>
                  {allJobs.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      No runs yet. Trigger a sync above to move data in.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Job</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Started</TableHead>
                            <TableHead className="text-right">Records</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {allJobs.slice(0, 50).map((j) => (
                            <TableRow key={`${j.jobId}-${j.createdAt ?? ''}`}>
                              <TableCell className="font-mono text-xs text-foreground">
                                {j.jobId ?? '—'}
                              </TableCell>
                              <TableCell>
                                <Badge className={JOB_TONE[j.status]}>{j.status}</Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {whenLabel(j.createdAt)}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {j.recordsSynced != null ? formatRows(j.recordsSynced) : '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      }
    </PageFrame>
  );
}

export default function PipelinesPage() {
  return <PipelinesContent />;
}
