'use client';

import { ArrowClockwise } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { QueueReadiness, WorkerReadinessSummary } from '@/lib/task-queue-readiness';
import { parseWorkerIdentity } from '@/lib/worker-artifact-identity';

// Live durable-worker readiness for the worker/temporal service detail. Proves — from real
// DescribeTaskQueue poller evidence — that a compatible worker is draining each durable queue, the
// gap that kept temporal:worker-readiness and app-worker:task-queue-readiness from being verifiable.
// Poll-driven (not navigational), so it holds no URL state.

const STATUS_UI: Record<QueueReadiness['status'], { dot: string; text: string; label: string }> = {
  ready: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Ready' },
  'no-pollers': { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'No poller' },
  unreachable: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Unreachable' },
  'not-configured': { dot: 'bg-muted-foreground', text: 'text-muted-foreground', label: 'Not configured' },
};

export function WorkerReadinessPanel() {
  const [summary, setSummary] = useState<WorkerReadinessSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/workers/readiness', { cache: 'no-store' });
      if (!res.ok) {
        setError(`readiness probe failed (${res.status})`);
        return;
      }
      setError(null);
      setSummary((await res.json()) as WorkerReadinessSummary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Durable worker readiness</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Live poller evidence per task queue (Temporal DescribeTaskQueue).
            {summary ? ` ${summary.readyCount}/${summary.totalCount} queues ready.` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <ArrowClockwise className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Re-probe
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {!summary && !error && <p className="text-xs text-muted-foreground">Probing…</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(summary?.queues ?? []).map((q) => {
            const ui = STATUS_UI[q.status];
            return (
              <div key={q.queue} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-foreground">{q.queue}</span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className={`size-2 rounded-full ${ui.dot}`} />
                    <span className={ui.text}>{ui.label}</span>
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {q.pollerCount} poller{q.pollerCount === 1 ? '' : 's'}
                  {q.backlogCount !== null ? ` · backlog ${q.backlogCount}` : ''}
                </p>
                {q.pollers.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {q.pollers.map((p) => {
                      const parsed = parseWorkerIdentity(p.identity);
                      return (
                        <li key={p.identity} className="font-mono text-[10px] text-muted-foreground">
                          {parsed ? `${parsed.pid}@${parsed.host}` : p.identity}
                          {parsed?.sha ? (
                            <span
                              className="ml-1 rounded bg-muted px-1 text-foreground"
                              title="deployed worker artifact SHA"
                            >
                              {parsed.sha}
                            </span>
                          ) : null}
                          {p.lastAccessTime ? ` · ${new Date(p.lastAccessTime).toLocaleTimeString()}` : ''}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
