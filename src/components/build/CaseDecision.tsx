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
  // "This was wrong" opens a reason box. Rejecting without saying why teaches the app nothing, and a
  // reason is also what a later reviewer needs to understand the decision.
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState('');
  // A read-only demo account is refused server-side (403). Reporting that in a toast AFTER the click meant
  // the button looked live, did nothing, and explained itself in a message that then faded. The constraint
  // is known before the click, so it is stated before the click.
  const viewer = useIsViewer();

  async function decide(decision: 'approve' | 'reject', note?: string) {
    setBusy(decision);
    try {
      const res = await fetch(`/api/v1/admin/apps/runs/${encodeURIComponent(runId)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The NOTE is what makes this a learning loop rather than a switch. The review route already
        // captures a reviewer's note as a golden case for the app's pipeline, so the next quality run is
        // measured against real human feedback — but nothing in the UI ever sent one, so the loop had
        // never once fired: measured on this tenant, ZERO corrections from real use.
        body: JSON.stringify({ decision, stepId, ...(note?.trim() ? { note: note.trim() } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        // Report the server's own reason. A read-only demo viewer is refused here, and being told why is
        // more useful than a generic failure.
        toast.error(data.error ?? 'The decision could not be applied.');
        return;
      }
      toast.success(
        note?.trim()
          ? 'Recorded — and the app will be checked against what you said from now on.'
          : decision === 'approve'
            ? 'Approved — the case continues.'
            : 'Rejected — the case stops.',
      );
      // Refresh so the case leaves the queue and the counts above it move together.
      router.refresh();
    } catch {
      toast.error('The decision could not be sent.');
    } finally {
      setBusy(null);
    }
  }

  const controls = correcting ? (
    <span
      className="flex w-full flex-col gap-1.5"
      onClick={(e) => {
        // Inside a row that is a link — typing must not navigate away mid-sentence.
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <input
        value={reason}
        autoFocus
        placeholder="What should it have done instead?"
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setCorrecting(false);
          if (e.key === 'Enter' && reason.trim()) void decide('reject', reason);
        }}
        className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          This becomes a test the app is checked against.
        </span>
        <span className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setCorrecting(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            disabled={busy !== null || !reason.trim()}
            onClick={() => void decide('reject', reason)}
          >
            Send it back
          </Button>
        </span>
      </span>
    </span>
  ) : (
    <span className="flex shrink-0 items-center gap-1.5">
      {/* "THIS WAS WRONG" — the affordance that did not exist. The correction loop works end to end and
          had never been exercised by a human, because nowhere in the product could a person say so. */}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null}
        aria-label="Say what this got wrong"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCorrecting(true);
        }}
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
      >
        This was wrong
      </Button>
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
