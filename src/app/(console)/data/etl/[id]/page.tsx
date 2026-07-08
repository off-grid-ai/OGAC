import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EtlBuilder } from '@/components/data/etl/EtlBuilder';
import { EtlJobActions } from '@/components/data/EtlJobActions';
import { Badge } from '@/components/ui/badge';
import { defaultDag, type EtlDagSpec, type EtlJobSpec } from '@/lib/etl-job';
import type { RedactionAction } from '@/lib/data-redaction';
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

// ETL job DETAIL — a full-page VISUAL data-movement builder (source → transforms → destination) plus
// run history + logs. Full-width; the canvas + config panel fill the width and the run history sits
// below. The job's DAG is the source of truth the pipeline compiles from; older jobs without a DAG
// are back-filled from their flat fields so they open in the builder too. This is the "place" the
// list drills into (list→detail IA), never a modal.
export default async function EtlJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('data');
  const { id } = await params;
  const orgId = await currentOrgId();
  const job = await getEtlJob(id, orgId);
  if (!job) notFound();

  const [runs, connectors] = await Promise.all([listEtlRuns(id, orgId), listConnectors(orgId)]);
  const connectorOptions = connectors.map((c) => ({ id: c.id, name: c.name, type: c.type }));

  // Back-fill a DAG for jobs authored before the visual builder.
  const dag: EtlDagSpec = job.dag ?? backfillDag(job);

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
            {job.lastRunStatus ? <Badge className={JOB_TONE[job.lastRunStatus]}>{job.lastRunStatus}</Badge> : null}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Build the movement visually: read from a connected source, shape and redact the rows, and
            land them in a warehouse table. Save it, then run it now or on a schedule — every run is
            governed and recorded.
          </p>
        </div>
        <EtlJobActions jobId={job.id} />
      </div>

      <EtlBuilder
        jobId={job.id}
        jobName={job.name}
        initialDag={dag}
        connectors={connectorOptions}
        initialRuns={runs}
      />
    </div>
  );
}

// Seed a DAG from a legacy flat job (source → [redact nodes] → destination).
function backfillDag(job: EtlJobSpec): EtlDagSpec {
  const base = defaultDag();
  const src = base.nodes.find((n) => n.kind === 'source')!;
  const dst = base.nodes.find((n) => n.kind === 'destination')!;
  src.config = { connectorId: job.sourceConnectorId, resource: job.sourceResource };
  dst.config = { database: job.destDatabase, table: job.destTable };
  const redactNodes = job.mappings
    .filter((m) => m.action && m.action !== 'keep')
    .map((m, i) => ({
      id: `redact_${i + 1}`,
      kind: 'redact' as const,
      label: `Redact ${m.source}`,
      config: {
        column: m.source,
        action: (m.action ?? 'mask') as RedactionAction,
        keepLast: m.keepLast,
      },
      position: { x: 260 + i * 180, y: 260 },
    }));
  if (redactNodes.length === 0) {
    return { ...base, trigger: job.trigger, cron: job.cron, rowLimit: job.rowLimit };
  }
  const chain = [src.id, ...redactNodes.map((n) => n.id), dst.id];
  const edges = chain.slice(0, -1).map((from, i) => ({ from, to: chain[i + 1] }));
  return { nodes: [src, ...redactNodes, dst], edges, trigger: job.trigger, cron: job.cron, rowLimit: job.rowLimit };
}
