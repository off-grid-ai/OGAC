import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import { listAgentRunsByAgent } from '@/lib/agentrun';
import { resolveAgent } from '@/lib/agents';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const STATUS_COLOR: Record<string, string> = {
  done: 'bg-primary/10 text-primary',
  blocked: 'bg-destructive/10 text-destructive',
  denied: 'bg-destructive/10 text-destructive',
};

export default async function AgentRunsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('agents');
  const { id } = await params;
  const agent = await resolveAgent(id, await currentOrgId());
  if (!agent) notFound();
  // Degrade gracefully: DB down → empty run history ("No runs yet.") not the whole-page error boundary.
  const runs = await listAgentRunsByAgent(id, 100).catch(() => []);

  return (
    <div className="space-y-6">
      <Link
        href={`/agents/${id}`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {agent.name}
      </Link>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Run history — {agent.name}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {runs.length} runs. Click a row for the full pipeline trace.
          </p>
        </CardHeader>
        <CardContent>
          {runs.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Query</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>Checks</TableHead>
                  <TableHead>Signed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <Link href={`/agents/${id}/runs/${r.id}`} className="hover:text-primary">
                        {r.startedAt.slice(0, 16).replace('T', ' ')}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-sm truncate text-foreground">
                      <Link href={`/agents/${id}/runs/${r.id}`} className="hover:text-primary">
                        {r.query}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_COLOR[r.status] ?? ''}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.steps.length}</TableCell>
                    <TableCell className="text-muted-foreground">{r.checks.length}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.provenance?.algorithm ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No runs yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
