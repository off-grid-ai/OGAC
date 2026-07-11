import { ArrowsLeftRight, Database } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { NewEtlJobButton } from '@/components/data/etl/NewEtlJobButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listEtlJobs } from '@/lib/etl-jobs-store';
import type { EtlJobStatus } from '@/lib/etl-model';
import { requireModuleForUser } from '@/lib/module-access';
import { listConnectors } from '@/lib/store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const JOB_TONE: Record<EtlJobStatus, string> = {
  succeeded: 'bg-primary/10 text-primary',
  running: 'bg-amber-500/10 text-amber-600',
  pending: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

function whenLabel(iso?: string): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'never' : d.toISOString().slice(0, 16).replace('T', ' ');
}

// ETL jobs — the AUTHOR/CREATE surface the Pipelines view lacks. An operator writes a data-movement
// job here (source connector → destination warehouse table → column mapping + per-column redaction →
// schedule), saves it, and runs it. Full-width, list→detail (each job opens /data/etl/[id]). Product
// language throughout — "Data movement / ETL jobs", never the engine name.
export default async function EtlJobsPage() {
  await requireModuleForUser('data');
  const orgId = await currentOrgId();
  const [jobs, connectors] = await Promise.all([listEtlJobs(orgId), listConnectors(orgId)]);
  const connectorOptions = connectors.map((c) => ({ id: c.id, name: c.name, type: c.type }));

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ArrowsLeftRight className="size-4 text-primary" />
            ETL jobs
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Author a data-movement job: pull from a connected source, redact sensitive columns on the
            way, and land the rows in a warehouse table — on a schedule or on demand. Every run is
            governed and recorded.
          </p>
        </div>
        <NewEtlJobButton hasConnectors={connectorOptions.length > 0} />
      </div>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
            <p>
              No ETL jobs yet. Create one to move data from a source into your warehouse — pick a
              source connector, choose the destination table, and decide what to redact on the way.
            </p>
            {connectorOptions.length === 0 ? (
              <p className="text-xs">
                You have no source connectors yet.{' '}
                <Link href="/data" className="text-primary underline">
                  Add a connector
                </Link>{' '}
                first.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => {
            const sourceName =
              connectorOptions.find((c) => c.id === job.sourceConnectorId)?.name ??
              job.sourceConnectorId;
            return (
              <Link key={job.id} href={`/data/etl/${job.id}`} className="block">
                <Card className="h-full shadow-sm transition-colors hover:border-primary/40">
                  <CardHeader className="space-y-0 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm">{job.name}</CardTitle>
                      {job.lastRunStatus ? (
                        <Badge className={JOB_TONE[job.lastRunStatus]}>{job.lastRunStatus}</Badge>
                      ) : (
                        <Badge className="bg-muted text-muted-foreground">no runs</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Database className="size-3.5" />
                      <span className="truncate">
                        {sourceName} · {job.sourceResource} → {job.destDatabase}.{job.destTable}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>{job.trigger === 'schedule' ? `cron: ${job.cron}` : 'Manual'}</span>
                      <span>Last run: {whenLabel(job.lastRunAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
