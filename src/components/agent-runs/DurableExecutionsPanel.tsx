'use client';

import {
  ArrowClockwise,
  ArrowLeft,
  ArrowsClockwise,
  Prohibit,
  XCircle,
} from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LoadingBlock } from '@/components/ui/spinner';
import { workflowActionsFor, type WorkflowExecutionStatus } from '@/lib/temporal-visibility';

// The Jobs surface — the operator's live view of durable workflow executions (Temporal-side),
// distinct from the recorded DB run history. Shows every job's STATE, timing, and correlated run,
// and lets the operator RERUN a finished job or CANCEL/TERMINATE a running one. Self-fetches
// /api/v1/admin/agent-runs/workflows and auto-refreshes while anything is still running. Detail
// drill-in is URL-driven (?wf=). Graceful when Temporal is off — empty state + a clear note.

// The three lifecycle actions an operator can take on a durable job.
type WorkflowActionKind = 'rerun' | 'cancel' | 'terminate';

interface ExecutionRow {
  workflowId: string;
  executionRunId?: string;
  temporalStatus: WorkflowExecutionStatus;
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

// Poll cadence while at least one execution is still open, so "what's running now" stays live-ish.
const LIVE_POLL_MS = 5000;

// Default for load()'s opts — hoisted so it isn't reallocated per call / flagged as an inline default.
const DEFAULT_LOAD_OPTS: { spinner?: boolean } = { spinner: true };

function when(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

// Emerald/amber/red status dot vocabulary, matching the console's run-status palette.
function statusPillTone(status: string): string {
  if (status === 'running' || status === 'queued') return 'text-primary border-primary/40';
  if (status === 'failed') return 'text-destructive border-destructive/40';
  if (status === 'cancelled') return 'text-muted-foreground border-border';
  return 'text-foreground border-border';
}

function StatusPill({ status, temporalStatus }: Readonly<{ status: string; temporalStatus: string }>) {
  const tone = statusPillTone(status);
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${tone}`}>
      {status}
      <span className="text-[10px] text-muted-foreground">({temporalStatus})</span>
    </span>
  );
}

async function workflowAction(
  workflowId: string,
  action: WorkflowActionKind,
): Promise<{ ok: boolean; message: string }> {
  const base = `/api/v1/admin/agent-runs/workflows/${encodeURIComponent(workflowId)}`;
  const res =
    action === 'rerun'
      ? await fetch(`${base}/rerun`, { method: 'POST' })
      : await fetch(`${base}/cancel`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: action === 'terminate' ? 'terminate' : 'cancel' }),
        });
  if (res.ok) {
    const labels = { rerun: 'Re-run dispatched', cancel: 'Cancel requested', terminate: 'Job terminated' };
    return { ok: true, message: labels[action] };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, message: body.error ?? `Action failed (${res.status})` };
}

export function DurableExecutionsPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wf = params.get('wf') ?? undefined;

  const [view, setView] = useState<ExecutionsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (opts: { spinner?: boolean } = DEFAULT_LOAD_OPTS) => {
    if (opts.spinner) setLoading(true);
    const r = await fetch('/api/v1/admin/agent-runs/workflows');
    setView(r.ok ? await r.json() : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live-ish refresh: while any execution is still open, quietly re-poll on an interval (no spinner)
  // so the operator sees jobs progress/close without clicking Refresh.
  const anyOpen = !!view?.executions.some((e) => e.status === 'running' || e.status === 'queued');
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!wf && anyOpen) {
      const t = setInterval(() => void loadRef.current({ spinner: false }), LIVE_POLL_MS);
      return () => clearInterval(t);
    }
  }, [wf, anyOpen]);

  const setWf = useCallback(
    (value?: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set('wf', value);
      else next.delete('wf');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const act = useCallback(
    async (e: ExecutionRow, action: WorkflowActionKind) => {
      if (action === 'cancel' && !confirm(`Cancel job ${e.workflowId}?`)) return;
      if (action === 'terminate' && !confirm(`Force-terminate job ${e.workflowId}? This cannot be undone.`))
        return;
      setBusyId(e.workflowId);
      const r = await workflowAction(e.workflowId, action);
      setBusyId(null);
      if (r.ok) {
        toast.success(r.message);
        void load({ spinner: false });
      } else {
        toast.error(r.message);
      }
    },
    [load],
  );

  if (wf) return <ExecutionDetail workflowId={wf} onBack={() => setWf(undefined)} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Durable jobs running on the Temporal runtime — which are running, at what state, and their
          correlated run. Re-run a finished job or cancel a running one. Separate from the recorded
          run history.
        </p>
        <Button size="xs" variant="outline" className="ml-auto gap-1" onClick={() => void load()}>
          <ArrowsClockwise className="size-3" /> Refresh
        </Button>
      </div>

      {loading ? (
        <LoadingBlock label="Loading jobs…" />
      ) : !view ? (
        <p className="text-sm text-muted-foreground">Could not load durable jobs.</p>
      ) : !view.configured ? (
        <div className="rounded-md border border-border p-4 text-sm">
          <p className="font-medium text-foreground">Durable runtime not enabled</p>
          <p className="mt-1 text-muted-foreground">
            {view.note ??
              'Enable the durable runtime in Settings to run agents as durable jobs. Runs still execute synchronously in-process without it.'}
          </p>
        </div>
      ) : !view.reachable ? (
        <div className="rounded-md border border-border p-4 text-sm">
          <p className="font-medium text-foreground">Temporal configured but unreachable</p>
          <p className="mt-1 text-muted-foreground">{view.note}</p>
        </div>
      ) : view.executions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No durable jobs yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {Object.entries(view.statusCounts).map(([s, n]) => (
              <span key={s} className="rounded-md border border-border px-2 py-1 text-muted-foreground">
                {s}: {n}
              </span>
            ))}
            {anyOpen ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" /> live
              </span>
            ) : null}
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Job (workflow)</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Run</th>
                  <th className="p-2">Events</th>
                  <th className="p-2">Started</th>
                  <th className="p-2">Closed</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {view.executions.map((e) => {
                  const actions = workflowActionsFor(e.temporalStatus);
                  const busy = busyId === e.workflowId;
                  return (
                    <tr key={e.workflowId} className="border-t border-border align-top">
                      <td className="p-2 font-mono text-xs">
                        <button onClick={() => setWf(e.workflowId)} className="text-primary hover:underline">
                          {e.workflowId}
                        </button>
                      </td>
                      <td className="p-2">
                        <StatusPill status={e.status} temporalStatus={e.temporalStatus} />
                      </td>
                      <td className="p-2 font-mono text-xs text-muted-foreground">{e.runId ?? '—'}</td>
                      <td className="p-2">{e.historyLength ?? '—'}</td>
                      <td className="p-2 text-xs text-muted-foreground">{when(e.startTime)}</td>
                      <td className="p-2 text-xs text-muted-foreground">{when(e.closeTime)}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {actions.rerun ? (
                            <Button
                              size="xs"
                              variant="outline"
                              className="gap-1"
                              disabled={busy}
                              onClick={() => void act(e, 'rerun')}
                            >
                              <ArrowClockwise className="size-3" /> Re-run
                            </Button>
                          ) : null}
                          {actions.cancel ? (
                            <>
                              <Button
                                size="xs"
                                variant="outline"
                                className="gap-1"
                                disabled={busy}
                                onClick={() => void act(e, 'cancel')}
                              >
                                <Prohibit className="size-3" /> Cancel
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                className="gap-1 text-destructive"
                                disabled={busy}
                                onClick={() => void act(e, 'terminate')}
                              >
                                <XCircle className="size-3" /> Terminate
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ExecutionDetail({ workflowId, onBack }: Readonly<{ workflowId: string; onBack: () => void }>) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/v1/admin/agent-runs/workflows/${encodeURIComponent(workflowId)}`);
    setDetail(r.ok ? await r.json() : null);
    setLoading(false);
  }, [workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  const e = detail?.execution;
  const actions = e ? workflowActionsFor(e.temporalStatus) : { rerun: false, cancel: false };

  async function act(action: WorkflowActionKind) {
    if (action === 'cancel' && !confirm(`Cancel job ${workflowId}?`)) return;
    if (action === 'terminate' && !confirm(`Force-terminate job ${workflowId}? This cannot be undone.`)) return;
    setBusy(true);
    const r = await workflowAction(workflowId, action);
    setBusy(false);
    if (r.ok) {
      toast.success(r.message);
      void load();
    } else {
      toast.error(r.message);
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Back to jobs
      </button>

      {loading ? (
        <LoadingBlock label="Loading job…" />
      ) : !detail?.found ? (
        <p className="text-sm text-muted-foreground">{detail?.note ?? 'Job not found.'}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm">{detail.workflowId}</span>
            {e ? <StatusPill status={e.status} temporalStatus={e.temporalStatus} /> : null}
            {e?.runId ? <span className="text-xs text-muted-foreground">run {e.runId}</span> : null}
            <div className="ml-auto flex flex-wrap gap-1">
              {actions.rerun ? (
                <Button size="xs" variant="outline" className="gap-1" disabled={busy} onClick={() => void act('rerun')}>
                  <ArrowClockwise className="size-3" /> Re-run
                </Button>
              ) : null}
              {actions.cancel ? (
                <>
                  <Button size="xs" variant="outline" className="gap-1" disabled={busy} onClick={() => void act('cancel')}>
                    <Prohibit className="size-3" /> Cancel
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    className="gap-1 text-destructive"
                    disabled={busy}
                    onClick={() => void act('terminate')}
                  >
                    <XCircle className="size-3" /> Terminate
                  </Button>
                </>
              ) : null}
            </div>
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

function Field({ label, value, mono }: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={mono ? 'font-mono' : undefined}>{value}</div>
    </div>
  );
}
