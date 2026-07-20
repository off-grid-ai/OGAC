'use client';

import { ArrowsClockwise, ArrowCounterClockwise, Prohibit, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { type AppRunControlAction, availableAppRunControls } from '@/lib/app-run-control';

// run-actions: the full durable app-run intervention matrix, rendered per run status.
//   in-flight → cancel (graceful) / terminate (force)
//   terminal  → reset (replay from start) / rerun (fresh run from the same input)
// The server route (POST .../workflow) re-enforces eligibility + performs the Temporal control.

const SPEC: Record<
  AppRunControlAction,
  { label: string; Icon: typeof X; tone: string; confirm?: string }
> = {
  cancel: { label: 'Cancel', Icon: X, tone: 'text-muted-foreground hover:text-foreground' },
  terminate: {
    label: 'Terminate',
    Icon: Prohibit,
    tone: 'text-red-600 hover:text-red-500 dark:text-red-400',
    confirm: 'Force-terminate this run? This cannot be undone.',
  },
  reset: { label: 'Replay', Icon: ArrowCounterClockwise, tone: 'text-muted-foreground hover:text-foreground' },
  rerun: { label: 'Re-run', Icon: ArrowsClockwise, tone: 'text-muted-foreground hover:text-foreground' },
};

export function AppRunControl({ runId, status }: { runId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const actions = availableAppRunControls(status);
  if (actions.length === 0) return null;

  async function act(action: AppRunControlAction) {
    const spec = SPEC[action];
    if (spec.confirm && !confirm(`${spec.confirm}\n\nRun ${runId}`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/app-runs/${encodeURIComponent(runId)}/workflow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; newRunId?: string };
      if (!res.ok) {
        toast.error(data.error ?? `${spec.label} failed (${res.status})`);
        return;
      }
      toast.success(
        action === 'rerun'
          ? `Re-run dispatched${data.newRunId ? ` (${data.newRunId})` : ''}`
          : action === 'reset'
            ? 'Replay started'
            : action === 'terminate'
              ? 'Run terminated'
              : 'Cancellation requested',
      );
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {actions.map((action) => {
        const { label, Icon, tone } = SPEC[action];
        return (
          <button
            key={action}
            type="button"
            disabled={busy}
            onClick={() => void act(action)}
            className={`inline-flex items-center gap-1 text-xs disabled:opacity-50 ${tone}`}
          >
            <Icon className="size-3" /> {label}
          </button>
        );
      })}
    </span>
  );
}
