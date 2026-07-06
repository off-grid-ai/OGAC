'use client';

import {
  ArrowClockwise,
  CheckCircle,
  CircleNotch,
  Clock,
  UserCircle,
  XCircle,
} from '@phosphor-icons/react/dist/ssr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type AppRunView,
  type AppRunStepRow,
  type StatusTone,
  awaitingStep,
  canReview,
  describeDuration,
  progress,
  shouldPoll,
  statusLabel,
  statusTone,
} from '@/lib/app-runs-view';
import { AppReview } from '@/components/build/AppReview';

// ─── AppRunStatus (Builder Epic Phase 4A) — the RUNNING screen (screen 3 of 5) ────────────────────
//
// A LIVE monitoring view of one app-run. It renders the per-step lifecycle (queued → running →
// done/failed, and awaiting_human) from the persisted app_runs row, and POLLS every ~2s while the
// run is open (queued/running/awaiting_human), stopping the moment it goes terminal. Each step shows
// its output, the sources/refs it read (connector rows, retrieval hits, guardrail verdicts as
// `detail`), and a duration. When a `human` step pauses the run, it inlines the REVIEW surface
// (screen 4) so the operator can approve/reject without leaving the page.
//
// SOLID: all presentation rules (label/tone/awaiting/progress/poll) are the pure functions in
// app-runs-view.ts; this component only fetches + renders what they return. Navigation stays in the
// URL — the page route owns the /apps/runs/[id] address; a resume re-fetches in place.

const POLL_MS = 2000;

function toneClasses(tone: StatusTone): string {
  switch (tone) {
    case 'active':
      return 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
    case 'warn':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-500';
    case 'success':
      return 'bg-primary/10 text-primary';
    case 'error':
      return 'bg-destructive/10 text-destructive';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function StatusIcon({ status }: { status: string }) {
  const tone = statusTone(status);
  const cls = 'size-3.5';
  if (tone === 'success') return <CheckCircle className={cls} weight="fill" />;
  if (tone === 'error') return <XCircle className={cls} weight="fill" />;
  if (tone === 'warn') return <UserCircle className={cls} weight="fill" />;
  if (tone === 'active') return <CircleNotch className={`${cls} animate-spin`} />;
  return <Clock className={cls} />;
}

export function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  return (
    <Badge
      variant="secondary"
      className={`${toneClasses(statusTone(status))} ${small ? 'text-[10px]' : ''} gap-1`}
    >
      <StatusIcon status={status} />
      {statusLabel(status)}
    </Badge>
  );
}

export function AppRunStatus({ initial }: { initial: AppRunView }) {
  const [run, setRun] = useState<AppRunView>(initial);
  const [polling, setPolling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/app-runs?appId=${encodeURIComponent(initial.appId)}&limit=200`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const { data } = (await res.json()) as { data: AppRunView[] };
      const found = data.find((r) => r.id === initial.id);
      if (found) setRun(found);
    } catch {
      /* transient — keep last known state, next tick retries */
    }
  }, [initial.appId, initial.id]);

  // Poll while the run is live; stop when terminal. The effect re-arms whenever run.status changes.
  useEffect(() => {
    if (!shouldPoll(run.status)) {
      setPolling(false);
      return;
    }
    setPolling(true);
    timer.current = setTimeout(refresh, POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [run.status, run.steps, refresh]);

  const { done, total } = progress(run.steps);
  const pending = awaitingStep(run.steps);

  return (
    <div className="space-y-5">
      <Card className="shadow-sm">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-sm">Run {run.id}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {done}/{total} steps · started {run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}
              {polling ? (
                <span className="ml-2 inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
                  <CircleNotch className="size-3 animate-spin" /> live
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={run.status} />
            <button
              type="button"
              onClick={refresh}
              className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
              title="Refresh now"
            >
              <ArrowClockwise className="size-3.5" />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1.5">
            {run.steps.map((s, i) => (
              <StepRow key={s.id} step={s} index={i} />
            ))}
            {run.steps.length === 0 ? (
              <li className="rounded-md border border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
                No steps recorded yet.
              </li>
            ) : null}
          </ol>

          {run.outcome ? (
            <div className="mt-3 rounded-md border border-primary/25 bg-primary/[0.04] p-3">
              <p className="text-[11px] uppercase tracking-wide text-primary/80">Outcome</p>
              <pre className="mt-1 whitespace-pre-wrap text-sm text-foreground">{run.outcome}</pre>
            </div>
          ) : null}

          {run.provenance ? (
            <p className="mt-2 truncate text-[10px] text-muted-foreground" title={run.provenance.signature}>
              Signed {run.provenance.algorithm} · {run.provenance.signature.slice(0, 24)}…
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Screen 4 — inline when a human step has paused the run. */}
      {canReview(run) && pending ? (
        <AppReview run={run} pending={pending} onResolved={refresh} />
      ) : null}
    </div>
  );
}

function StepRow({ step, index }: { step: AppRunStepRow; index: number }) {
  return (
    <li className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">{step.label}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{step.kind}</span>
          <StatusBadge status={step.status} small />
          <span className="ml-auto text-[10px] text-muted-foreground">
            {describeDuration(step.startedAt, step.finishedAt)}
          </span>
        </div>
        {step.outcome ? (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-foreground">
            {step.outcome}
          </pre>
        ) : null}
        {step.detail ? <p className="mt-1 text-[11px] text-muted-foreground">{step.detail}</p> : null}
        {step.refs && step.refs.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {step.refs.map((r, i) => (
              <span key={i} className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {r}
              </span>
            ))}
          </div>
        ) : null}
        {step.childRunId ? (
          <p className="mt-1 text-[10px] text-muted-foreground">child run · {step.childRunId}</p>
        ) : null}
      </div>
    </li>
  );
}
