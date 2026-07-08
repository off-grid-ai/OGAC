import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EtlJobActions } from '@/components/data/EtlJobActions';
import { EtlJobForm } from '@/components/data/EtlJobForm';
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
import { destColumn } from '@/lib/etl-job';
import type { EtlJobStatus } from '@/lib/etl-model';
import { getEtlJob, listEtlRuns } from '@/lib/etl-jobs-store';
import { listConnectors } from '@/lib/store';
import { requireModuleForUser } from '@/lib/module-access';
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
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 19).replace('T', ' ');
}

// ETL job DETAIL — the deep, deep-linkable view behind one job: its full config, its run history,
// and every action (edit, delete, run-now). Full-width, two-column on wide screens. This is the
// "place" the list drills into (list→detail IA), not a modal.
export default async function EtlJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('data');
  const { id } = await params;
  const orgId = await currentOrgId();
  const job = await getEtlJob(id, orgId);
  if (!job) notFound();

  const [runs, connectors] = await Promise.all([listEtlRuns(id, orgId), listConnectors(orgId)]);
  const connectorOptions = connectors.map((c) => ({ id: c.id, name: c.name, type: c.type }));
  const sourceName =
    connectorOptions.find((c) => c.id === job.sourceConnectorId)?.name ?? job.sourceConnectorId;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/data/etl"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            ETL jobs
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            {job.name}
            {job.lastRunStatus ? (
              <Badge className={JOB_TONE[job.lastRunStatus]}>{job.lastRunStatus}</Badge>
            ) : null}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <EtlJobForm connectors={connectorOptions} mode="edit" job={job} />
          <EtlJobActions jobId={job.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Config */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <Row label="Source" value={`${sourceName} · ${job.sourceResource}`} />
            <Row label="Destination" value={`${job.destDatabase}.${job.destTable}`} />
            <Row
              label="Trigger"
              value={job.trigger === 'schedule' ? `Scheduled (${job.cron})` : 'Manual'}
            />
            <Row label="Row limit" value={String(job.rowLimit ?? 1000)} />
            <div>
              <p className="mb-1 font-medium text-muted-foreground">Column mapping</p>
              {job.mappings.length === 0 ? (
                <p className="text-muted-foreground">Full copy — every column, unredacted.</p>
              ) : (
                <div className="space-y-1">
                  {job.mappings.map((m, i) => (
                    <div key={i} className="flex items-center justify-between font-mono text-[11px]">
                      <span>
                        {m.source} → {destColumn(m)}
                      </span>
                      <Badge className="bg-muted text-muted-foreground">{m.action ?? 'keep'}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Run history */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Run history</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No runs yet. Use “Run now” to move data and land it in the warehouse.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Path</TableHead>
                      <TableHead className="text-right">Read</TableHead>
                      <TableHead className="text-right">Written</TableHead>
                      <TableHead className="text-right">Redacted</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <TableRow key={r.runId}>
                        <TableCell>
                          <Badge className={JOB_TONE[r.status]}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.path}</TableCell>
                        <TableCell className="text-right">{r.rowsRead}</TableCell>
                        <TableCell className="text-right">{r.rowsWritten}</TableCell>
                        <TableCell className="text-right">{r.redacted}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {whenLabel(r.startedAt)}
                        </TableCell>
                        <TableCell className="max-w-[24rem] truncate text-muted-foreground">
                          {r.message ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
