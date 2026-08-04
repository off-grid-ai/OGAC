'use client';

import { Check, X } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ReadOnlyGuard } from '@/components/ReadOnlyGuard';
import { useIsViewer } from '@/components/ViewerModeProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { explainResponse } from '@/lib/api-failure';
import { describeBatch, MAX_BATCH, type BulkCandidate, type BulkDecision } from '@/lib/bulk-decide';

// ─── Decide the selected cases ───────────────────────────────────────────────────────────────────────
//
// Seven near-identical reimbursements were seven round trips. This is the batch form of the same
// decision — and it posts to the batch route, which itself replays each case through the ordinary review
// route, so there is no second decision path with its own governance to keep in step.
//
// It stays quiet until something is selected: a permanently-visible bulk bar over a queue of one is
// noise, and worse, it invites selecting everything.
export function BulkDecideBar({
  appId,
  selected,
  onDone,
}: Readonly<{
  appId: string;
  selected: BulkCandidate[];
  onDone: () => void;
}>) {
  const router = useRouter();
  const viewer = useIsViewer();
  const [busy, setBusy] = useState<BulkDecision | null>(null);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  if (selected.length === 0) return null;

  async function run(decision: BulkDecision) {
    setBusy(decision);
    const res = await fetch('/api/v1/admin/apps/runs/bulk-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        appId,
        runIds: selected.map((c) => c.runId),
        decision,
        ...(reason.trim() ? { note: reason.trim() } : {}),
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { reasons?: string[] };
      if (data.reasons?.length) {
        // The pure rules say precisely what is wrong (mixed processes, over the cap, no reason given).
        toast.error(data.reasons.join(' '));
        return;
      }
      const f = await explainResponse(res, 'decide these cases');
      (f.refusal ? toast.info : toast.error)(f.message);
      return;
    }
    const data = (await res.json()) as { summary: string; failed: number };
    // A partial failure is reported as a warning, never as success with a smaller number — the
    // dangerous version of this feature is one that lets someone walk away thinking the queue is clear.
    toast[data.failed > 0 ? 'warning' : 'success'](data.summary);
    setRejecting(false);
    setReason('');
    onDone();
    router.refresh();
  }

  const bar = (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-md border border-primary/40 bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
      <span className="text-sm text-foreground">
        {/* What is about to happen, in a sentence — not a bare count. Includes the age of the oldest,
            so a batch cannot quietly sweep up something long-forgotten. */}
        {describeBatch(selected, rejecting ? 'reject' : 'approve')}
      </span>
      {selected.length > MAX_BATCH ? (
        <span className="text-xs text-destructive">
          Too many at once — {MAX_BATCH} is the limit.
        </span>
      ) : null}
      {rejecting ? (
        <>
          <Input
            value={reason}
            autoFocus
            placeholder="Why are these being sent back?"
            onChange={(e) => setReason(e.target.value)}
            className="h-8 min-w-[16rem] flex-1 text-xs"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={busy !== null || !reason.trim()}
            onClick={() => void run('reject')}
          >
            {busy === 'reject' ? 'Sending back…' : 'Send them back'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setRejecting(true)} className="gap-1">
              <X className="size-3.5" />
              Send back
            </Button>
            <Button
              size="sm"
              disabled={busy !== null || selected.length > MAX_BATCH}
              onClick={() => void run('approve')}
              className="gap-1"
            >
              <Check className="size-3.5" weight="bold" />
              {busy === 'approve' ? 'Approving…' : `Approve ${selected.length}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );

  return viewer ? <ReadOnlyGuard>{bar}</ReadOnlyGuard> : bar;
}
