import { readObjectTopology } from '@/lib/adapters/object-topology-read';
import {
  describeCapacity,
  describeDurability,
  topologyNeedsAttention,
} from '@/lib/object-topology';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// ─── DurabilityPanel — if a disk dies, what is lost? ─────────────────────────────────────────────
//
// The console could already say the object store was UP, which is the least interesting thing about it.
// This answers the question an operator actually has. On the audited deployment the answer is that
// there is one copy of every file — and rendering that as a green tick would be worse than showing
// nothing, because the operator would then believe something untrue about where their data lives.
//
// A server component: it reads the coordinator on render, and a failure says the state is UNKNOWN
// rather than drawing an empty, reassuring box.
export async function DurabilityPanel() {
  const outcome = await readObjectTopology();

  if (!outcome.ok) {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">If a disk fails, what happens to these files?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-destructive">
            {outcome.reason}. How many copies of each file exist is UNKNOWN — that is not the same as
            confirmed safe.
          </p>
        </CardContent>
      </Card>
    );
  }

  const view = outcome.view;
  const attention = topologyNeedsAttention(view);
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm">If a disk fails, what happens to these files?</CardTitle>
          <CardDescription className="text-xs">{describeCapacity(view)}</CardDescription>
        </div>
        <Badge variant={attention ? 'destructive' : 'secondary'}>
          {attention ? 'needs attention' : 'redundant'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={attention ? 'text-sm font-medium text-destructive' : 'text-sm'}>
          {describeDurability(view)}
        </p>
        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Copies of each file" value={view.replication ? String(view.replication.copies) : 'unknown'} />
          <Stat label="Machines storing them" value={String(view.nodes.length)} />
          <Stat label="Separate racks" value={String(view.racks)} />
          <Stat label="Separate sites" value={String(view.dataCentres)} />
        </div>
        {view.nodes.length > 0 ? (
          <div className="divide-y divide-border rounded-md border border-border text-xs">
            {view.nodes.map((n) => (
              <div key={n.url} className="flex items-center justify-between px-3 py-2">
                <span className="font-mono">{n.url}</span>
                <span className="text-muted-foreground">
                  {n.volumes} of {n.max} slots used
                  {n.ecShards > 0 ? ` · ${n.ecShards} recovery shards` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
