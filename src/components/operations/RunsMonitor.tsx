'use client';

import {
  ArrowClockwise,
  ArrowRight,
  CheckCircle,
  Clock,
  MagnifyingGlass,
  PauseCircle,
  Pulse,
  XCircle,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { StatRail } from '@/components/ui/StatRail';
import {
  type RunKind,
  type RunRow,
  type RunStatus,
  RUN_STATUSES,
  describeDuration,
  isLive,
  kindLabel,
  statusLabel,
} from '@/lib/runs-monitor';

// ─── RunsMonitor — the unified Operations → Runs list (URL-driven, live-refreshing) ───────────────
//
// Renders the merged app/agent/chat run list. All navigational state — the kind tab, the status
// filter, and the free-text query — lives in the URL (?kind=&status=&q=), so Back is coherent and a
// filtered view is shareable. Rows deep-link to the run's detail (app runs → their per-app run page;
// agent/chat → the generic Operations run detail). While any listed run is live (queued/running/
// paused) it polls the API every few seconds so the operator watches status change in place.
//
// Product language throughout — App / Agent / Chat, Queued / Running / Awaiting review / Succeeded /
// Failed / Cancelled. No engine or scheduler names surface here.

const POLL_MS = 4000;

interface Summary {
  total: number;
  live: number;
  byStatus: Record<RunStatus, number>;
  byKind: Record<RunKind, number>;
}

interface RunsResponse {
  data: RunRow[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  summary: Summary;
}

const KIND_TABS: { id: RunKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'app', label: 'Apps' },
  { id: 'agent', label: 'Agents' },
  { id: 'chat', label: 'Chat' },
];

function statusToneClasses(status: RunStatus): string {
  switch (status) {
    case 'running':
      return 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
    case 'queued':
      return 'bg-muted text-muted-foreground';
    case 'paused':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-500';
    case 'succeeded':
      return 'bg-primary/10 text-primary';
    case 'failed':
      return 'bg-destructive/10 text-destructive';
    case 'cancelled':
      return 'bg-muted text-muted-foreground';
  }
}

function StatusIcon({ status }: { status: RunStatus }) {
  const cls = 'size-3.5';
  if (status === 'succeeded') return <CheckCircle className={cls} weight="fill" />;
  if (status === 'failed') return <XCircle className={cls} weight="fill" />;
  if (status === 'paused') return <PauseCircle className={cls} weight="fill" />;
  if (status === 'running') return <Spinner className={cls} />;
  if (status === 'cancelled') return <XCircle className={cls} />;
  return <Clock className={cls} />;
}

function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge variant="secondary" className={`${statusToneClasses(status)} gap-1`}>
      <StatusIcon status={status} />
      {statusLabel(status)}
    </Badge>
  );
}

const KIND_BADGE: Record<RunKind, string> = {
  app: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  agent: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  chat: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

export function RunsMonitor({ initial }: { initial: RunsResponse }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const kind = (params.get('kind') as RunKind | 'all' | null) ?? 'all';
  const status = (params.get('status') as RunStatus | 'all' | null) ?? 'all';
  const q = params.get('q') ?? '';

  const [resp, setResp] = useState<RunsResponse>(initial);
  const [live, setLive] = useState(false);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [queryDraft, setQueryDraft] = useState(q);

  // Keep the search box in sync when the URL changes from elsewhere (Back/forward).
  useEffect(() => setQueryDraft(q), [q]);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
      startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [params, pathname, router],
  );

  const refresh = useCallback(async () => {
    try {
      const sp = new URLSearchParams();
      if (kind !== 'all') sp.set('kind', kind);
      if (status !== 'all') sp.set('status', status);
      if (q) sp.set('q', q);
      sp.set('limit', '200');
      const res = await fetch(`/api/v1/admin/runs?${sp.toString()}`, { cache: 'no-store' });
      if (!res.ok) return;
      setResp((await res.json()) as RunsResponse);
    } catch {
      /* transient — keep last known state; next tick retries */
    }
  }, [kind, status, q]);

  // Refetch whenever the URL filters change (server passes only the first render's initial).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while any listed run is live; stop when all terminal.
  const anyLive = useMemo(() => resp.data.some((r) => isLive(r.status)), [resp.data]);
  useEffect(() => {
    if (!anyLive) {
      setLive(false);
      return;
    }
    setLive(true);
    timer.current = setTimeout(refresh, POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [anyLive, resp.data, refresh]);

  const s = resp.summary;

  return (
    <div className="w-full space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Pulse className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Runs</h1>
            <p className="text-sm text-muted-foreground">
              Every job across the platform — apps, agents, and chat — with live status. Watch
              what&apos;s running, review what paused for a human, and drill into any run.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowClockwise className="size-3.5" /> Refresh
          {live ? (
            <span className="ml-1 inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
              <Spinner className="size-3" /> live
            </span>
          ) : null}
        </button>
      </div>

      {/* Summary band */}
      <StatRail at="lg" cols={6}>
        <Stat label="Total" value={s.total} />
        <Stat label="Live" value={s.live} tone="active" />
        <Stat label="Running" value={s.byStatus.running} tone="active" />
        <Stat label="Awaiting review" value={s.byStatus.paused} tone="warn" />
        <Stat label="Succeeded" value={s.byStatus.succeeded} tone="success" />
        <Stat label="Failed" value={s.byStatus.failed} tone="error" />
      </StatRail>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Kind tabs */}
        <div className="inline-flex rounded-md border border-border p-0.5">
          {KIND_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setParam('kind', t.id)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                kind === t.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="inline-flex flex-wrap gap-1">
          <FilterChip active={status === 'all'} onClick={() => setParam('status', 'all')}>
            Any status
          </FilterChip>
          {RUN_STATUSES.map((st) => (
            <FilterChip key={st} active={status === st} onClick={() => setParam('status', st)}>
              {statusLabel(st)}
            </FilterChip>
          ))}
        </div>

        {/* Free-text query */}
        <div className="relative ml-auto min-w-[14rem] flex-1 sm:max-w-xs">
          <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={queryDraft}
            onChange={(e) => setQueryDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setParam('q', queryDraft.trim());
            }}
            onBlur={() => setParam('q', queryDraft.trim())}
            placeholder="Search name, pipeline, actor…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Started</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Pipeline</th>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {resp.data.map((r) => (
              <tr key={r.key} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[r.kind]}`}>
                    {kindLabel(r.kind)}
                  </span>
                </td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-foreground" title={r.name}>
                  {r.name}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {describeDuration(r.durationMs)}
                </td>
                <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-xs text-muted-foreground" title={r.pipeline}>
                  {r.pipeline}
                </td>
                <td className="max-w-[10rem] truncate px-3 py-2 text-xs text-muted-foreground" title={r.actor}>
                  {r.actor || '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={r.href}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {r.status === 'paused' ? 'Review' : 'Open'} <ArrowRight className="size-3" />
                  </Link>
                </td>
              </tr>
            ))}
            {resp.data.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-sm text-muted-foreground">
                  {q || kind !== 'all' || status !== 'all'
                    ? 'No runs match these filters.'
                    : 'No runs yet. Run an app, agent, or chat and it will appear here.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {resp.hasMore ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing the {resp.data.length} most recent of {resp.total}.
        </p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'active' | 'warn' | 'success' | 'error';
}) {
  const toneCls =
    tone === 'active'
      ? 'text-sky-600 dark:text-sky-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-500'
        : tone === 'success'
          ? 'text-primary'
          : tone === 'error'
            ? 'text-destructive'
            : 'text-foreground';
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-xs ${
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
