'use client';

import { CaretDown, CaretRight } from '@phosphor-icons/react/dist/ssr';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
import type { EtlRunView } from '@/lib/etl-job';
import type { EtlJobStatus } from '@/lib/etl-model';

const TONE: Record<EtlJobStatus, string> = {
  succeeded: 'bg-primary/10 text-primary',
  running: 'bg-amber-500/10 text-amber-600',
  pending: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

interface LogLine {
  ts?: string;
  level?: string;
  message: string;
  taskId?: string;
}

function whenLabel(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 19).replace('T', ' ');
}

// Run history for an ETL job. Live-polls the runs endpoint while any run is 'running' (the server
// refreshes orchestrated executions from the engine). Each run expands to its engine logs, fetched
// on demand. Honest: a failed run shows its message; unreachable-engine logs come back empty.
export function EtlRunHistory({ jobId, initialRuns }: Readonly<{ jobId: string; initialRuns: EtlRunView[] }>) {
  const [runs, setRuns] = useState<EtlRunView[]>(initialRuns);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/etl/jobs/${jobId}/runs`);
      if (!res.ok) return;
      const b = (await res.json()) as { data?: EtlRunView[] };
      if (Array.isArray(b.data)) setRuns(b.data);
    } catch {
      /* transient — keep the last-known runs */
    }
  }, [jobId]);

  // Poll every 4s while any run is still running; also refresh on the builder's run event.
  useEffect(() => {
    const anyRunning = runs.some((r) => r.status === 'running');
    if (anyRunning && !timer.current) {
      timer.current = setInterval(load, 4000);
    } else if (!anyRunning && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [runs, load]);

  useEffect(() => {
    const onRefresh = () => void load();
    window.addEventListener('etl-run-refresh', onRefresh);
    return () => window.removeEventListener('etl-run-refresh', onRefresh);
  }, [load]);

  async function toggle(run: EtlRunView) {
    if (expanded === run.runId) {
      setExpanded(null);
      return;
    }
    setExpanded(run.runId);
    if (!logs[run.runId]) {
      try {
        const res = await fetch(`/api/v1/admin/etl/jobs/${jobId}/logs?runId=${encodeURIComponent(run.runId)}`);
        const b = (await res.json().catch(() => ({}))) as { data?: LogLine[] };
        setLogs((m) => ({ ...m, [run.runId]: Array.isArray(b.data) ? b.data : [] }));
      } catch {
        setLogs((m) => ({ ...m, [run.runId]: [] }));
      }
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Run history</CardTitle>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No runs yet. Use “Run now” to move data through the pipeline and land it in the warehouse.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Status</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead className="text-right">Read</TableHead>
                  <TableHead className="text-right">Written</TableHead>
                  <TableHead className="text-right">Redacted</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <Fragment key={r.runId}>
                    <TableRow className="cursor-pointer" onClick={() => toggle(r)}>
                      <TableCell>
                        {expanded === r.runId ? <CaretDown className="size-3.5" /> : <CaretRight className="size-3.5" />}
                      </TableCell>
                      <TableCell>
                        <Badge className={TONE[r.status]}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.path === 'kestra' ? 'orchestrated' : r.path}
                      </TableCell>
                      <TableCell className="text-right">{r.rowsRead}</TableCell>
                      <TableCell className="text-right">{r.rowsWritten}</TableCell>
                      <TableCell className="text-right">{r.redacted}</TableCell>
                      <TableCell className="text-muted-foreground">{whenLabel(r.startedAt)}</TableCell>
                      <TableCell className="max-w-[24rem] truncate text-muted-foreground" title={r.message}>
                        {r.message ?? '—'}
                      </TableCell>
                    </TableRow>
                    {expanded === r.runId ? (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30">
                          <LogView lines={logs[r.runId]} orchestrated={r.path === 'kestra'} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LogView({ lines, orchestrated }: Readonly<{ lines?: LogLine[]; orchestrated: boolean }>) {
  if (lines === undefined) return <p className="py-2 text-xs text-muted-foreground">Loading logs…</p>;
  if (lines.length === 0) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        {orchestrated
          ? 'No logs available — the run may still be starting, or the orchestration engine is unreachable.'
          : 'This run used the direct-copy path; its outcome is summarized above.'}
      </p>
    );
  }
  return (
    <pre className="max-h-64 overflow-auto rounded bg-black/90 p-3 font-mono text-[11px] leading-relaxed text-emerald-300">
      {lines
        .map((l) => `${l.ts ? `${l.ts.slice(11, 19)} ` : ''}${l.level ? `[${l.level}] ` : ''}${l.taskId ? `${l.taskId}: ` : ''}${l.message}`)
        .join('\n')}
    </pre>
  );
}
