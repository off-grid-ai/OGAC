import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
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
import { listAgentRuns } from '@/lib/agentrun';
import { safeListTraces } from '@/lib/langfuse';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const STATUS_CLASS: Record<string, string> = {
  done: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
  denied: 'bg-destructive/10 text-destructive',
};

export default async function InsightsAiTracesPage() {
  await requireModuleForUser('observability');
  const orgId = await currentOrgId();
  const [traceReadback, runs] = await Promise.all([
    safeListTraces(100),
    listAgentRuns(100, orgId).catch(() => []),
  ]);

  return (
    <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
      <Card className="shadow-sm xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">Trace store</CardTitle>
          <p className="text-xs text-muted-foreground">
            Each trace opens as a deep-linked span waterfall with its recorded timing and model
            data.
          </p>
        </CardHeader>
        <CardContent>
          {!traceReadback.configured ? (
            <EmptyState>
              Trace read-back is not configured. Connect the tracing store to inspect emitted spans.
            </EmptyState>
          ) : traceReadback.error ? (
            <p className="text-xs text-destructive">
              Trace store unreachable: {traceReadback.error}
            </p>
          ) : traceReadback.traces.length === 0 ? (
            <EmptyState>No traces yet. Run an app or agent to emit the first trace.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trace</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Recorded</TableHead>
                    <TableHead className="w-24 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {traceReadback.traces.map((trace) => (
                    <TableRow key={trace.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">
                          {trace.name || 'Unnamed trace'}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {trace.id}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {trace.userId || '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {trace.latency == null ? '—' : `${Math.round(trace.latency)}ms`}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {trace.totalCost == null ? '—' : `$${trace.totalCost.toFixed(4)}`}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatTimestamp(trace.timestamp)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/insights/ai/traces/${encodeURIComponent(trace.id)}`}>
                            Inspect <ArrowRight className="size-3.5" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">Governed agent runs</CardTitle>
          <p className="text-xs text-muted-foreground">
            Open the owning agent run for its checks, provenance, and execution controls.
          </p>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyState>No governed agent runs yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Checks</TableHead>
                    <TableHead>Provenance</TableHead>
                    <TableHead className="w-24 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-mono text-xs text-foreground">
                        {run.agentId}
                      </TableCell>
                      <TableCell className="max-w-lg truncate text-xs text-muted-foreground">
                        {run.query}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={STATUS_CLASS[run.status] ?? ''}>
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {run.checks.length}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {run.provenance?.algorithm ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/solutions/agents/${run.agentId}/runs/${run.id}`}>
                            Open <ArrowRight className="size-3.5" />
                          </Link>
                        </Button>
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
  );
}

function EmptyState({ children }: Readonly<{ children: React.ReactNode }>) {
  return <p className="py-8 text-center text-xs text-muted-foreground">{children}</p>;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
