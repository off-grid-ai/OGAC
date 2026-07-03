import { Database, Stack, Warning } from '@phosphor-icons/react/dist/ssr';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireModuleForUser } from '@/lib/module-access';
import { readRetrieval, type CollectionStatus } from '@/lib/retrieval-view';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<CollectionStatus, string> = {
  green: 'bg-primary/10 text-primary',
  yellow: 'bg-yellow-500/10 text-yellow-600',
  red: 'bg-destructive/10 text-destructive',
  grey: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
};

export default async function RetrievalPage() {
  await requireModuleForUser('retrieval');
  const { data, error } = await readRetrieval();
  const view = data!;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Database className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Retrieval</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Vector store behind the retrieval layer — collections, vector counts, and health for
              the active adapter. Read directly from the backend, never leaves your infrastructure.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            {view.adapterId}
          </Badge>
          <Badge
            variant="secondary"
            className={view.reachable ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}
          >
            {view.reachable ? 'reachable' : 'unreachable'}
          </Badge>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-3">
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Adapter</p>
            <p className="text-sm text-foreground">{view.adapterId}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Endpoint</p>
            <p className="truncate font-mono text-xs text-foreground">{view.url ?? '—'}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Total vectors
            </p>
            <p className="text-sm text-foreground">{view.totalVectors.toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>

      {!view.isQdrant ? (
        <Card className="shadow-sm">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            The active retrieval adapter is <span className="font-mono">{view.adapterId}</span>. This
            collection read-back is only available for the Qdrant backend. Set{' '}
            <span className="font-mono">OFFGRID_ADAPTER_RETRIEVAL=qdrant</span> and{' '}
            <span className="font-mono">OFFGRID_QDRANT_URL</span> to inspect it here.
          </CardContent>
        </Card>
      ) : !view.reachable ? (
        <Card className="shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <Warning className="size-5 text-muted-foreground" />
            <span>
              Vector store unreachable{error ? ` — ${error}` : ''}. Check{' '}
              <span className="font-mono">OFFGRID_QDRANT_URL</span> and that Qdrant is running.
            </span>
          </CardContent>
        </Card>
      ) : view.collections.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No collections yet. Index documents through the retrieval layer and they appear here.
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Collection</TableHead>
                  <TableHead className="text-right">Vectors</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.collections.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="flex items-center gap-2 font-medium text-foreground">
                      <Stack className="size-3.5 text-muted-foreground" />
                      {c.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.vectorsCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.pointsCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary" className={STATUS_CLASS[c.status]}>
                        {c.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
