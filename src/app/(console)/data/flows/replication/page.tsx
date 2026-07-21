import { ArrowRight, Clock } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { PipelinesContent } from '@/app/(console)/data/pipelines/page';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { airbyteEtl } from '@/lib/adapters/airbyte';

export const dynamic = 'force-dynamic';

// Replication surface: the live pipeline runner (sync now / job history — PipelinesContent) PLUS a
// schedule-management list where each connection is a way IN to its detail view (schedule, per-stream
// sync modes, state reset). List→detail, URL-driven: cards link to /data/flows/replication/[id].
export default async function ReplicationPage() {
  const connections = await airbyteEtl.listConnections();

  return (
    <div className="w-full space-y-8">
      <PipelinesContent embedded showHeading={false} />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Schedules &amp; sync modes</h2>
          <span className="text-xs text-muted-foreground">
            Open a connection to set its cadence, per-stream sync mode, or reset its state.
          </span>
        </div>
        {connections.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No connections are configured yet. Add a source and destination to create one.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {connections.map((c) => (
              <Link
                key={c.connectionId}
                href={`/data/flows/replication/${encodeURIComponent(c.connectionId)}`}
                className="group"
              >
                <Card className="h-full shadow-sm transition-colors group-hover:border-primary/40">
                  <CardHeader className="space-y-0 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm">{c.name}</CardTitle>
                      <Badge
                        className={
                          c.status === 'active'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {c.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{c.schedule ?? 'manual'}</span>
                    <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
