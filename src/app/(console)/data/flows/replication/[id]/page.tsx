import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConnectionScheduleManager } from '@/components/data/ConnectionScheduleManager';
import { Badge } from '@/components/ui/badge';
import { PageFrame } from '@/components/PageFrame';
import { airbyteEtl } from '@/lib/adapters/airbyte';
import { normalizeConnectionDetail } from '@/lib/airbyte-schedule-model';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Replication connection DETAIL (list→detail) — the deep, deep-linkable view behind one Airbyte
// connection: its schedule, per-stream sync modes, and a state-reset control. Consumes the live
// Airbyte adapter directly (server component); the pure model shapes the read. Every mutation runs
// through the governed /api/v1/admin/data/airbyte routes. Deep-linkable: /data/flows/replication/[id].
export default async function ReplicationConnectionDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('data');
  const { id } = await params;

  const raw = await airbyteEtl.getConnectionRaw(id);
  if (!raw) notFound();
  const connection = normalizeConnectionDetail(raw);

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <div className="min-w-0">
          <Link
            href="/data/flows/replication"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Replication
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-foreground">
            {connection.name}
            <Badge
              className={
                connection.status === 'active'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground'
              }
            >
              {connection.status}
            </Badge>
          </h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{connection.connectionId}</p>
        </div>

        <ConnectionScheduleManager connection={connection} />
      </div>
    </PageFrame>
  );
}
