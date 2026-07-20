'use client';

import { Prohibit, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

// run-actions: cancel (graceful) / terminate (force) a running or paused durable app-run workflow.
// Rendered only for in-flight runs; the server route (api/.../app-runs/[id]/cancel) enforces the
// real eligibility + Temporal control. A router.refresh() re-reads the list after the action.
export function AppRunControl({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(mode: 'cancel' | 'terminate') {
    const verb = mode === 'terminate' ? 'Force-terminate' : 'Cancel';
    if (!confirm(`${verb} run ${runId}?${mode === 'terminate' ? ' This cannot be undone.' : ''}`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/app-runs/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? `${verb} failed (${res.status})`);
        return;
      }
      toast.success(mode === 'terminate' ? 'Run terminated' : 'Cancellation requested');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void act('cancel')}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <X className="size-3" /> Cancel
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void act('terminate')}
        className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-500 disabled:opacity-50 dark:text-red-400"
      >
        <Prohibit className="size-3" /> Terminate
      </button>
    </span>
  );
}
