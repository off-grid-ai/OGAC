import type { ReactNode } from 'react';
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
import { evalEngineLabel } from '@/lib/eval-engine-label';
import type { EvalRunView } from '@/lib/evals-view';

export function QualityExecutionHistory({
  runs,
  actionsFor,
}: Readonly<{
  runs: EvalRunView[];
  actionsFor: (run: EvalRunView) => ReactNode;
}>) {
  return (
    <>
      <div
        data-quality-execution-records
        role="list"
        aria-label="Recent evaluation executions"
        className="grid gap-3 lg:hidden"
      >
        {runs.map((run) => (
          <Card
            key={run.id}
            role="listitem"
            aria-label={`Execution ${run.id}`}
            className="shadow-none"
          >
            <CardContent className="space-y-4 p-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div className="col-span-2 min-w-0">
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Run
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs">{run.id}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Suite
                  </dt>
                  <dd className="mt-1">
                    <Badge variant="outline" className="text-[10px]">
                      {evalEngineLabel(run.engine)}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Pass rate
                  </dt>
                  <dd className="mt-1 text-sm font-medium">{run.score}%</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Passed
                  </dt>
                  <dd className="mt-1 text-sm text-primary">{run.passed}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Failed
                  </dt>
                  <dd className="mt-1 text-sm text-destructive">{run.failed}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Started
                  </dt>
                  <dd className="mt-1 break-words text-xs text-muted-foreground">
                    {run.startedAt ?? '—'}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Actions
                </span>
                {actionsFor(run)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div data-quality-execution-table className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Suite</TableHead>
              <TableHead className="text-right">Pass rate</TableHead>
              <TableHead className="text-right">Passed</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="font-mono text-xs">{run.id}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">
                    {evalEngineLabel(run.engine)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium">{run.score}%</TableCell>
                <TableCell className="text-right text-primary">{run.passed}</TableCell>
                <TableCell className="text-right text-destructive">{run.failed}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {run.startedAt ?? '—'}
                </TableCell>
                <TableCell className="text-right">{actionsFor(run)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
