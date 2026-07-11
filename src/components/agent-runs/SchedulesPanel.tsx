'use client';

import { ArrowsClockwise, Pause, Play, Plus, Trash, X } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LoadingBlock, Spinner } from '@/components/ui/spinner';

// Temporal Schedules management — recurring/cron agent runs. Self-fetches
// /api/v1/admin/agent-runs/schedules. The create form is a URL-driven panel (?new=1), not a modal;
// delete is confirmed. Pause/resume + delete are the lifecycle actions.

interface ScheduleRow {
  scheduleId: string;
  paused: boolean;
  note?: string;
  cron: string[];
  workflowType?: string;
  recentActions: string[];
  nextActions: string[];
  numActionsTaken?: number;
}
interface SchedulesView {
  configured: boolean;
  reachable: boolean;
  note?: string;
  schedules: ScheduleRow[];
}

function when(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export function SchedulesPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const creating = params.get('new') === '1';

  const [view, setView] = useState<SchedulesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch('/api/v1/admin/agent-runs/schedules');
    setView(r.ok ? await r.json() : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setNew = useCallback(
    (on: boolean) => {
      const next = new URLSearchParams(params.toString());
      if (on) next.set('new', '1');
      else next.delete('new');
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  async function toggle(s: ScheduleRow) {
    setBusy(s.scheduleId);
    const r = await fetch(`/api/v1/admin/agent-runs/schedules/${encodeURIComponent(s.scheduleId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paused: !s.paused }),
    });
    setBusy(null);
    if (r.ok) {
      toast.success(s.paused ? 'Schedule resumed' : 'Schedule paused');
      void load();
    } else toast.error((await r.json().catch(() => ({}))).error ?? 'Failed');
  }

  async function remove(s: ScheduleRow) {
    if (!confirm(`Delete schedule ${s.scheduleId}? This stops all future runs.`)) return;
    setBusy(s.scheduleId);
    const r = await fetch(`/api/v1/admin/agent-runs/schedules/${encodeURIComponent(s.scheduleId)}`, {
      method: 'DELETE',
    });
    setBusy(null);
    if (r.ok) {
      toast.success('Schedule deleted');
      void load();
    } else toast.error((await r.json().catch(() => ({}))).error ?? 'Failed');
  }

  if (creating) {
    return (
      <CreateScheduleForm
        onCancel={() => setNew(false)}
        onCreated={() => {
          setNew(false);
          void load();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Recurring agent runs. A schedule fires the agent pipeline on a cron spec as a durable
          workflow.
        </p>
        <div className="ml-auto flex gap-1">
          <Button size="xs" variant="outline" className="gap-1" onClick={() => void load()}>
            <ArrowsClockwise className="size-3" /> Refresh
          </Button>
          <Button size="xs" className="gap-1" onClick={() => setNew(true)}>
            <Plus className="size-3" /> New schedule
          </Button>
        </div>
      </div>

      {loading ? (
        <LoadingBlock label="Loading schedules…" />
      ) : !view ? (
        <p className="text-sm text-muted-foreground">Could not load schedules.</p>
      ) : !view.configured ? (
        <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          {view.note ?? 'Durable runtime not enabled.'}
        </div>
      ) : !view.reachable ? (
        <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          Temporal is configured but unreachable. {view.note}
        </div>
      ) : view.schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No schedules yet. Create one to run an agent on a cron.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">Schedule</th>
                <th className="p-2">Cron</th>
                <th className="p-2">State</th>
                <th className="p-2">Fired</th>
                <th className="p-2">Next run</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {view.schedules.map((s) => (
                <tr key={s.scheduleId} className="border-t border-border align-top">
                  <td className="p-2 font-mono text-xs">
                    {s.scheduleId}
                    {s.note ? <div className="text-muted-foreground">{s.note}</div> : null}
                  </td>
                  <td className="p-2 font-mono text-xs">{s.cron.join(', ') || '—'}</td>
                  <td className="p-2">{s.paused ? 'paused' : 'active'}</td>
                  <td className="p-2">{s.numActionsTaken ?? 0}×</td>
                  <td className="p-2 text-xs text-muted-foreground">{when(s.nextActions[0])}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        className="gap-1"
                        disabled={busy === s.scheduleId}
                        onClick={() => toggle(s)}
                      >
                        {s.paused ? <Play className="size-3" /> : <Pause className="size-3" />}
                        {s.paused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        className="gap-1 text-destructive"
                        disabled={busy === s.scheduleId}
                        onClick={() => remove(s)}
                      >
                        <Trash className="size-3" /> Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateScheduleForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [scheduleId, setScheduleId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [query, setQuery] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [note, setNote] = useState('');
  const [requireReview, setRequireReview] = useState(false);
  const [paused, setPaused] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const r = await fetch('/api/v1/admin/agent-runs/schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scheduleId: scheduleId.trim() || undefined,
        agentId,
        query,
        cron,
        note: note.trim() || undefined,
        requireReview,
        paused,
      }),
    });
    setSubmitting(false);
    if (r.ok) {
      toast.success('Schedule created');
      onCreated();
    } else {
      toast.error((await r.json().catch(() => ({}))).error ?? 'Failed to create schedule');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <button
        type="button"
        onClick={onCancel}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" /> Cancel
      </button>
      <h2 className="font-mono text-sm font-semibold">New recurring agent run</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label="Agent ID" hint="required">
          <input required value={agentId} onChange={(e) => setAgentId(e.target.value)} className={inputCls} />
        </Labeled>
        <Labeled label="Schedule ID" hint="optional — auto-generated if blank">
          <input value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} className={inputCls} />
        </Labeled>
      </div>
      <Labeled label="Query" hint="required — the prompt each run executes">
        <textarea required value={query} onChange={(e) => setQuery(e.target.value)} rows={3} className={inputCls} />
      </Labeled>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label="Cron spec" hint="5- or 6-field cron, or @daily/@hourly">
          <input required value={cron} onChange={(e) => setCron(e.target.value)} className={`${inputCls} font-mono`} />
        </Labeled>
        <Labeled label="Note" hint="optional">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </Labeled>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={requireReview} onChange={(e) => setRequireReview(e.target.checked)} />
          Require review
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          Start paused
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner /> Creating…
            </>
          ) : (
            'Create schedule'
          )}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const inputCls =
  'w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary';

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 opacity-70">· {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
