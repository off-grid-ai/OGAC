'use client';

import {
  ArrowClockwise,
  ArrowLeft,
  CheckCircle,
  Prohibit,
  Trash,
  XCircle,
} from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { actionsFor, type RunAction } from '@/lib/agent-run-actions';
import type { RunSummaryRow, RunsSummary } from '@/lib/agent-runs';

// Full run trace, as returned by GET /api/v1/admin/agent-runs/[id].
interface RunTrace {
  id: string;
  agentId: string;
  query: string;
  answer: string;
  status: string;
  steps: { kind: string; label: string; detail: string; refs: string[]; ms: number }[];
  citations: { ref: string; title: string; snippet: string; score: number; supported: boolean }[];
  checks: { name: string; verdict: string; detail?: string }[];
  provenance: { signature: string; algorithm: string; signedAt: string } | null;
  startedAt: string;
}

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
}

// Runs management surface. Navigation (status filter + detail drill-in) lives entirely in the URL
// (?status= / ?run=) so Back is coherent and views are deep-linkable. The initial rows come from
// the server; actions re-fetch via router.refresh().
export function AgentRunsManager({
  runs,
  statusCounts,
  totalRuns,
}: Readonly<{
  runs: RunSummaryRow[];
  statusCounts: RunsSummary['statusCounts'];
  totalRuns: number;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get('status') ?? undefined;
  const runId = params.get('run') ?? undefined;

  const active = status && statusCounts[status] ? status : undefined;
  const shown = active ? runs.filter((r) => r.status === active) : runs;

  const setParam = useCallback(
    (key: string, value?: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  if (runId) {
    return <RunDetail id={runId} onBack={() => setParam('run', undefined)} onChanged={() => router.refresh()} />;
  }

  return (
    <div className="space-y-4">
      {/* Status filter — URL driven */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => setParam('status', undefined)}
          className={`rounded-md border px-2 py-1 ${!active ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
        >
          all ({totalRuns})
        </button>
        {Object.entries(statusCounts).map(([s, n]) => (
          <button
            key={s}
            onClick={() => setParam('status', s)}
            className={`rounded-md border px-2 py-1 ${active === s ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
          >
            {s} ({n})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agent runs recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">Run</th>
                <th className="p-2">Agent</th>
                <th className="p-2">Status</th>
                <th className="p-2">Steps</th>
                <th className="p-2">Duration</th>
                <th className="p-2">Started</th>
                <th className="p-2">Query</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <RunRow
                  key={r.id}
                  run={r}
                  onOpen={() => setParam('run', r.id)}
                  onChanged={() => router.refresh()}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  onOpen,
  onChanged,
}: Readonly<{
  run: RunSummaryRow;
  onOpen: () => void;
  onChanged: () => void;
}>) {
  const [busy, setBusy] = useState(false);
  const actions = actionsFor(run.status);

  async function act(action: RunAction | 'review-approve' | 'review-reject') {
    if (action === 'delete' && !confirm(`Delete run ${run.id}? This cannot be undone.`)) return;
    if (action === 'cancel' && !confirm(`Cancel run ${run.id}?`)) return;
    setBusy(true);
    const r = await runAction(run.id, action);
    setBusy(false);
    if (r.ok) {
      toast.success(r.message);
      onChanged();
    } else {
      toast.error(r.message);
    }
  }

  return (
    <tr className="border-t border-border align-top">
      <td className="p-2 font-mono text-xs">
        <button onClick={onOpen} className="text-primary hover:underline">
          {run.id}
        </button>
      </td>
      <td className="p-2">{run.agentId}</td>
      <td className="p-2">{run.status}</td>
      <td className="p-2">{run.stepCount}</td>
      <td className="p-2">{ms(run.durationMs)}</td>
      <td className="p-2 text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString()}</td>
      <td className="max-w-xs truncate p-2 text-muted-foreground">{run.query}</td>
      <td className="p-2">
        <div className="flex flex-wrap gap-1">
          {actions.includes('review') ? (
            <>
              <Button size="xs" variant="outline" className="gap-1" disabled={busy} onClick={() => act('review-approve')}>
                <CheckCircle className="size-3" /> Approve
              </Button>
              <Button size="xs" variant="outline" className="gap-1" disabled={busy} onClick={() => act('review-reject')}>
                <XCircle className="size-3" /> Reject
              </Button>
            </>
          ) : null}
          {actions.includes('rerun') ? (
            <Button size="xs" variant="outline" className="gap-1" disabled={busy} onClick={() => act('rerun')}>
              <ArrowClockwise className="size-3" /> Re-run
            </Button>
          ) : null}
          {actions.includes('cancel') ? (
            <Button size="xs" variant="outline" className="gap-1" disabled={busy} onClick={() => act('cancel')}>
              <Prohibit className="size-3" /> Cancel
            </Button>
          ) : null}
          {actions.includes('delete') ? (
            <Button size="xs" variant="outline" className="gap-1 text-destructive" disabled={busy} onClick={() => act('delete')}>
              <Trash className="size-3" /> Delete
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

// Dispatch an action to the right route. Review is split into approve/reject via a synthetic action.
async function runAction(
  id: string,
  action: RunAction | 'review-approve' | 'review-reject',
): Promise<{ ok: boolean; message: string }> {
  const base = `/api/v1/admin/agent-runs/${id}`;
  let res: Response;
  if (action === 'delete') {
    res = await fetch(base, { method: 'DELETE' });
  } else if (action === 'rerun') {
    res = await fetch(`${base}/rerun`, { method: 'POST' });
  } else if (action === 'cancel') {
    res = await fetch(`${base}/cancel`, { method: 'POST' });
  } else {
    const decision = action === 'review-approve' ? 'approve' : 'reject';
    res = await fetch(`${base}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
  }
  if (res.ok) {
    const labels: Record<string, string> = {
      delete: 'Run deleted',
      rerun: 'Re-run dispatched',
      cancel: 'Run cancelled',
      'review-approve': 'Run approved',
      'review-reject': 'Run rejected',
    };
    return { ok: true, message: labels[action] ?? 'Done' };
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, message: body.error ?? `Action failed (${res.status})` };
}

function RunDetail({ id, onBack, onChanged }: Readonly<{ id: string; onBack: () => void; onChanged: () => void }>) {
  const [run, setRun] = useState<RunTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/v1/admin/agent-runs/${id}`);
    setRun(r.ok ? await r.json() : null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: RunAction | 'review-approve' | 'review-reject') {
    if (action === 'delete' && !confirm(`Delete run ${id}? This cannot be undone.`)) return;
    if (action === 'cancel' && !confirm(`Cancel run ${id}?`)) return;
    setBusy(true);
    const r = await runAction(id, action);
    setBusy(false);
    if (r.ok) {
      toast.success(r.message);
      onChanged();
      if (action === 'delete') onBack();
      else void load();
    } else {
      toast.error(r.message);
    }
  }

  const actions = run ? actionsFor(run.status) : [];

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Back to runs
      </button>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading run…</p>
      ) : !run ? (
        <p className="text-sm text-muted-foreground">Run not found.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm">{run.id}</span>
            <span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {run.status}
            </span>
            <span className="text-xs text-muted-foreground">{run.agentId}</span>
            <div className="ml-auto flex flex-wrap gap-1">
              {actions.includes('review') ? (
                <>
                  <Button size="xs" variant="outline" className="gap-1" disabled={busy} onClick={() => act('review-approve')}>
                    <CheckCircle className="size-3" /> Approve
                  </Button>
                  <Button size="xs" variant="outline" className="gap-1" disabled={busy} onClick={() => act('review-reject')}>
                    <XCircle className="size-3" /> Reject
                  </Button>
                </>
              ) : null}
              {actions.includes('rerun') ? (
                <Button size="xs" variant="outline" className="gap-1" disabled={busy} onClick={() => act('rerun')}>
                  <ArrowClockwise className="size-3" /> Re-run
                </Button>
              ) : null}
              {actions.includes('cancel') ? (
                <Button size="xs" variant="outline" className="gap-1" disabled={busy} onClick={() => act('cancel')}>
                  <Prohibit className="size-3" /> Cancel
                </Button>
              ) : null}
              {actions.includes('delete') ? (
                <Button size="xs" variant="outline" className="gap-1 text-destructive" disabled={busy} onClick={() => act('delete')}>
                  <Trash className="size-3" /> Delete
                </Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">Query</div>
            <p className="whitespace-pre-wrap text-sm">{run.query}</p>
          </div>

          {run.answer ? (
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">Answer</div>
              <p className="whitespace-pre-wrap text-sm">{run.answer}</p>
            </div>
          ) : null}

          {/* Step timeline */}
          <div>
            <h2 className="mb-2 font-mono text-sm font-semibold">Timeline</h2>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2">Kind</th>
                    <th className="p-2">Label</th>
                    <th className="p-2">Detail</th>
                    <th className="p-2">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {run.steps.map((s, i) => (
                    <tr key={i} className="border-t border-border align-top">
                      <td className="p-2 font-mono text-xs">{s.kind}</td>
                      <td className="p-2">{s.label}</td>
                      <td className="max-w-md truncate p-2 text-muted-foreground">{s.detail}</td>
                      <td className="p-2">{ms(s.ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {run.checks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {run.checks.map((c, i) => (
                <span key={i} className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                  {c.name}: {c.verdict}
                </span>
              ))}
            </div>
          ) : null}

          {run.provenance ? (
            <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
              <span className="text-foreground">Provenance</span> · {run.provenance.algorithm} · signed{' '}
              {new Date(run.provenance.signedAt).toLocaleString()} ·{' '}
              <span className="font-mono">{run.provenance.signature.slice(0, 24)}…</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
