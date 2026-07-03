import { CheckCircle, Flask, XCircle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
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
import { readEvalsView } from '@/lib/evals-view';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Evals & red-team read-back — golden sets + quality gates. Suite drilldown is URL-driven
// (?suite=<engine>), so filtering is a plain link/back-stack navigation, never client state.
export default async function EvalsPage({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string }>;
}) {
  await requireModuleForUser('control');
  const { suite } = await searchParams;
  const view = await readEvalsView();

  const activeSuite = suite && view.suites.some((s) => s.engine === suite) ? suite : null;
  const runs = activeSuite
    ? view.recentRuns.filter((r) => r.engine === activeSuite)
    : view.recentRuns;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Flask className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Evals</h1>
          <p className="text-sm text-muted-foreground">
            Golden sets and quality gates — pass-rates per suite (Promptfoo / Ragas / DeepEval /
            golden), scored offline against the gateway. {view.goldenCases} golden case(s).
          </p>
        </div>
      </div>

      {/* Aggregate quality gate. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Pass rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-foreground">{view.totals.passRate}%</div>
            <Progress value={view.totals.passRate} className="mt-2 h-1.5" />
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Passed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1.5 text-2xl font-semibold text-primary">
              <CheckCircle className="size-5" />
              {view.totals.passed}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1.5 text-2xl font-semibold text-destructive">
              <XCircle className="size-5" />
              {view.totals.failed}
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-foreground">{view.totals.runs}</div>
          </CardContent>
        </Card>
      </div>

      {/* Per-suite rollup — each row links to its URL-driven drilldown. */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Suites</CardTitle>
        </CardHeader>
        <CardContent>
          {view.suites.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No eval runs yet. Run a suite to populate quality gates.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Link href="/evals">
                <Badge variant={activeSuite === null ? 'secondary' : 'outline'}>All</Badge>
              </Link>
              {view.suites.map((s) => (
                <Link key={s.engine} href={`/evals?suite=${encodeURIComponent(s.engine)}`}>
                  <Badge
                    variant={activeSuite === s.engine ? 'secondary' : 'outline'}
                    className="gap-1.5"
                  >
                    {s.engine} · {s.passRate}% ({s.passed}/{s.total})
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent runs, newest-first (filtered to the active suite when set). */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Recent runs{activeSuite ? ` · ${activeSuite}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No runs.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Suite</TableHead>
                  <TableHead className="text-right">Pass rate</TableHead>
                  <TableHead className="text-right">Passed</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.id}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {r.engine}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{r.score}%</TableCell>
                    <TableCell className="text-right text-primary">{r.passed}</TableCell>
                    <TableCell className="text-right text-destructive">{r.failed}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.startedAt ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
