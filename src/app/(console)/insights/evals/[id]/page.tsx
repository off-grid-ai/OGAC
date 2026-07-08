import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getEvalRun } from '@/lib/evals';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

export default async function EvalRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('observability');
  const { id } = await params;
  const run = await getEvalRun(id, await currentOrgId());
  if (!run) notFound();
  const cases = run.results ?? [];

  return (
    <div className="space-y-6">
      <Link
        href="/insights"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Observability
      </Link>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold text-foreground">{run.score}%</div>
            <Progress value={run.score} className="mt-3" />
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              Passed
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-foreground">
            {run.passed}/{run.total}
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              Run
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-sm text-foreground">{run.id}</div>
            <div className="text-xs text-muted-foreground">
              {run.startedAt.slice(0, 19).replace('T', ' ')}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm">Per-case results</CardTitle>
          <p className="text-xs text-muted-foreground">
            Each golden case run against retrieval — did the expected source surface in top-k.
          </p>
        </CardHeader>
        <CardContent>
          {cases.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Query</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Top hit</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-xs truncate text-foreground">{c.query}</TableCell>
                    <TableCell className="text-muted-foreground">{c.expected}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{c.top}</TableCell>
                    <TableCell className="text-muted-foreground">{c.score}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          c.pass ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                        }
                      >
                        {c.pass ? 'pass' : 'fail'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No per-case detail recorded for this run.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
