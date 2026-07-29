'use client';

import { Check, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ReadOnlyGuard } from '@/components/ReadOnlyGuard';
import { useIsViewer } from '@/components/ViewerModeProvider';

// ─── Approve or reject a case WITHOUT leaving the queue ──────────────────────────────────────────────
//
// Deciding IS the job. The work screen listed waiting cases but every row only navigated somewhere else to
// act, so the person whose entire task is "approve or reject" had to leave the list, decide, come back, and
// find their place again — for every case. That is the difference between a queue you work and a report you
// read (docs/APP_AS_PRODUCT.md, experience gap 1).
//
// Posts to the SAME review route the full review surface uses, so the durable workflow resumes identically
// and there is no second decision path to keep in step. The richer surface still exists for a case that
// needs the evidence and an edited output; this covers the common case, which is a straight yes or no.

export function CaseDecision({
  runId,
  stepId,
  compact = false,
}: Readonly<{ runId: string; stepId: string; compact?: boolean }>) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  // A read-only demo account is refused server-side (403). Reporting that in a toast AFTER the click meant
  // the button looked live, did nothing, and explained itself in a message that then faded. The constraint
  // is known before the click, so it is stated before the click.
  const viewer = useIsViewer();

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision);
    try {
      const res = await fetch(`/api/v1/admin/apps/runs/${encodeURIComponent(runId)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, stepId }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        // Report the server's own reason. A read-only demo viewer is refused here, and being told why is
        // more useful than a generic failure.
        toast.error(data.error ?? 'The decision could not be applied.');
        return;
      }
      toast.success(decision === 'approve' ? 'Approved — the case continues.' : 'Rejected — the case stops.');
      // Refresh so the case leaves the queue and the counts above it move together.
      router.refresh();
    } catch {
      toast.error('The decision could not be sent.');
    } finally {
      setBusy(null);
    }
  }

  const controls = (
    <span className="flex shrink-0 items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null}
        aria-label="Reject this case"
        onClick={(e) => {
          // The row is a link to the full case; a decision must not also navigate.
          e.preventDefault();
          e.stopPropagation();
          void decide('reject');
        }}
        className="h-7 gap-1 px-2 text-xs"
      >
        <X className="size-3.5" />
        {compact ? null : 'Reject'}
      </Button>
      <Button
        size="sm"
        disabled={busy !== null}
        aria-label="Approve this case"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void decide('approve');
        }}
        className="h-7 gap-1 px-2 text-xs"
      >
        <Check className="size-3.5" weight="bold" />
        {compact ? null : busy === 'approve' ? 'Approving…' : 'Approve'}
      </Button>
    </span>
  );

  // ReadOnlyGuard renders the child untouched for every other role, so this costs a writer nothing.
  return viewer ? <ReadOnlyGuard>{controls}</ReadOnlyGuard> : controls;
}
