'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { appRunHref } from '@/lib/action-outcome-routes';

interface OutcomeWithdrawButtonProps {
  appId: string;
  runId: string;
  stepId: string;
  outcomeId: string;
  eventId: string;
  observedAt: string;
}

export function OutcomeWithdrawButton({
  appId,
  runId,
  stepId,
  outcomeId,
  eventId,
  observedAt,
}: Readonly<OutcomeWithdrawButtonProps>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const runHref = appRunHref(appId, runId);

  async function withdraw() {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/admin/app-runs/${encodeURIComponent(runId)}/actions/${encodeURIComponent(stepId)}/outcomes/${encodeURIComponent(outcomeId)}`,
        {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            eventId,
            observedAt,
            note: reason.trim(),
            evidenceLinks: [runHref],
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
      };
      if (!response.ok) {
        setError(
          response.status === 409
            ? 'A newer result is already recorded. Refresh before withdrawing this one.'
            : body.reason || body.error || 'The record was not withdrawn. Nothing changed.',
        );
        return;
      }
      setOpen(false);
      router.push(runHref);
      router.refresh();
    } catch {
      setError('The record was not withdrawn. Nothing changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)} className="min-h-11">
        Withdraw record
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw this business result?</DialogTitle>
            <DialogDescription>
              The record stays in the audit history but no longer counts as the current result.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="withdraw-reason">Why is this being withdrawn?</Label>
            <Textarea
              id="withdraw-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              maxLength={2000}
              autoFocus
              required
            />
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Keep record
            </Button>
            <Button variant="destructive" onClick={withdraw} disabled={busy || !reason.trim()}>
              {busy ? 'Withdrawing…' : 'Withdraw record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
