import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageFrame } from '@/components/PageFrame';
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

export default async function QualityScorecardDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('observability');
  const { id } = await params;
  const run = await getEvalRun(id, await currentOrgId());
  if (!run) notFound();
  const cases = run.results ?? [];

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <Link
          href="/insights/quality/scorecards"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Scorecards
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
              Each golden case records whether the expected source appeared in the returned top-k.
            </p>
          </CardHeader>
          <CardContent>
            {cases.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No per-case detail was recorded for this run.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Query</TableHead>
                      <TableHead>Expected</TableHead>
                      <TableHead>Top hit</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cases.map((testCase, index) => (
                      <TableRow key={`${testCase.query}-${index}`}>
                        <TableCell className="max-w-xs truncate text-foreground">
                          {testCase.query}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{testCase.expected}</TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground">
                          {testCase.top}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {testCase.score}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="secondary"
                            className={
                              testCase.pass
                                ? 'bg-primary/10 text-primary'
                                : 'bg-destructive/10 text-destructive'
                            }
                          >
                            {testCase.pass ? 'pass' : 'fail'}
                          </Badge>
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
    </PageFrame>
  );
}
