'use client';

import { ArrowLeft, ArrowsClockwise } from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

// The Temporal-side view of durable executions — distinct from the DB run records the main table
// shows. Self-fetches /api/v1/admin/agent-runs/workflows. Detail drill-in is URL-driven (?wf=).

interface ExecutionRow {
  workflowId: string;
  executionRunId?: string;
  temporalStatus: string;
  status: string;
  startTime?: string;
  closeTime?: string;
  historyLength?: number;
  taskQueue?: string;
  runId?: string;
}
interface ExecutionsView {
  configured: boolean;
  reachable: boolean;
  note?: string;
  executions: ExecutionRow[];
  statusCounts: Record<string, number>;
}
interface WorkflowDetail {
  found: boolean;
  workflowId: string;
  execution?: ExecutionRow;
  result?: unknown;
  note?: string;
}

function when(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export function DurableExecutionsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wf = params.get('wf') ?? undefined;

  const [view, setView] = useState<ExecutionsView | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/v1/admin/agent-runs/workflows');
    setView(r.ok ? await r.json() : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setWf = useCallback(
    (value?: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set('wf', value);
      else next.delete('wf');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  if (wf) return <ExecutionDetail workflowId={wf} onBack={() => setWf(undefined)} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Temporal-side workflow executions. This is the durable runtime&rsquo;s own view — separate
          from the recorded run history above.
        </p>
        <Button size="xs" variant="outline" className="ml-auto gap-1" onClick={() => void load()}>
          <ArrowsClockwise className="size-3" /> Refresh
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading executions…</p>
      ) : !view ? (
        <p className="text-sm text-muted-foreground">Could not load durable executions.</p>
      ) : !view.configured ? (
        <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          {view.note ?? 'Durable runtime not enabled.'}
        </div>
      ) : !view.reachable ? (
        <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          Temporal is configured but unreachable. {view.note}
        </div>
      ) : view.executions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No durable workflow executions yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(view.statusCounts).map(([s, n]) => (
              <span key={s} className="rounded-md border border-border px-2 py-1 text-muted-foreground">
                {s}: {n}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Workflow</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Run</th>
                  <th className="p-2">Events</th>
                  <th className="p-2">Started</th>
                  <th className="p-2">Closed</th>
                </tr>
              </thead>
              <tbody>
                {view.executions.map((e) => (
                  <tr key={e.workflowId} className="border-t border-border align-top">
                    <td className="p-2 font-mono text-xs">
                      <button onClick={() => setWf(e.workflowId)} className="text-primary hover:underline">
                        {e.workflowId}
                      </button>
                    </td>
                    <td className="p-2">
                      {e.status} <span className="text-xs text-muted-foreground">({e.temporalStatus})</span>
                    </td>
                    <td className="p-2 font-mono text-xs text-muted-foreground">{e.runId ?? '—'}</td>
                    <td className="p-2">{e.historyLength ?? '—'}</td>
                    <td className="p-2 text-xs text-muted-foreground">{when(e.startTime)}</td>
                    <td className="p-2 text-xs text-muted-foreground">{when(e.closeTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ExecutionDetail({ workflowId, onBack }: { workflowId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await fetch(`/api/v1/admin/agent-runs/workflows/${encodeURIComponent(workflowId)}`);
      const d = r.ok ? await r.json() : null;
      if (alive) {
        setDetail(d);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [workflowId]);

  const e = detail?.execution;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Back to executions
      </button>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading workflow…</p>
      ) : !detail || !detail.found ? (
        <p className="text-sm text-muted-foreground">{detail?.note ?? 'Workflow not found.'}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm">{detail.workflowId}</span>
            {e ? (
              <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {e.status} ({e.temporalStatus})
              </span>
            ) : null}
            {e?.runId ? <span className="text-xs text-muted-foreground">run {e.runId}</span> : null}
          </div>
          {e ? (
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Field label="Execution runId" value={e.executionRunId ?? '—'} mono />
              <Field label="Task queue" value={e.taskQueue ?? '—'} />
              <Field label="History events" value={String(e.historyLength ?? '—')} />
              <Field label="Started" value={when(e.startTime)} />
              <Field label="Closed" value={when(e.closeTime)} />
            </div>
          ) : null}
          {detail.result !== undefined ? (
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">Result</div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(detail.result, null, 2)}
              </pre>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={mono ? 'font-mono' : undefined}>{value}</div>
    </div>
  );
}
