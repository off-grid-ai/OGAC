'use client';

import { Check, PencilSimple, UserCircle, X } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { type AppRunView, type AppRunStepRow, priorContextForReview } from '@/lib/app-runs-view';

// ─── AppReview (Builder Epic Phase 4A, HITL) — the REVIEW screen (screen 4 of 5) ──────────────────
//
// Surfaces a run PAUSED at a `human` step. It shows the reviewer the full context — the prior steps'
// outputs and the sources they read — plus the pending step's own input/output, then offers
// Approve / Reject and an optional edit-output box. The decision POSTs to the step-review route
// (/apps/runs/[id]/review) which invokes signalAppRun to resume the durable workflow: approve →
// continue, reject → halt. On success it calls onResolved so the RUNNING screen re-fetches and the
// run advances live.
//
// GRACEFUL: the route returns 409 { resumable:false } for an INLINE run (nothing to signal — it
// already terminated at the pause). We surface that honestly instead of pretending it resumed.

export function AppReview({
  run,
  pending,
  onResolved,
}: {
  run: AppRunView;
  pending: AppRunStepRow;
  onResolved?: () => void;
}) {
  const prior = priorContextForReview(run.steps);
  const [editing, setEditing] = useState(false);
  const [output, setOutput] = useState(pending.outcome ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<'approve' | 'reject' | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/apps/runs/${encodeURIComponent(run.id)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision,
          stepId: pending.id,
          ...(editing && output !== pending.outcome ? { output } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        resumable?: boolean;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'The decision could not be applied.');
        return;
      }
      setResolved(decision);
      toast.success(decision === 'approve' ? 'Approved — the run continues.' : 'Rejected — the run halts.');
      onResolved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-amber-500/40 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <UserCircle className="size-4 text-amber-600 dark:text-amber-500" weight="fill" />
          Human review — {pending.label}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          This run is paused for your decision. Approve to continue the workflow, or reject to halt it.
          You can edit the step output before approving.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Context: what ran before this pause. */}
        {prior.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Context so far</p>
            {prior.map((s) => (
              <div key={s.id} className="rounded-md border border-border/60 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{s.label}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{s.kind}</span>
                </div>
                {s.outcome ? (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-foreground">
                    {s.outcome}
                  </pre>
                ) : null}
                {s.refs && s.refs.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.refs.map((r, i) => (
                      <span key={i} className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {r}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {/* The pending step's output (editable). */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Pending output</Label>
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <PencilSimple className="size-3" /> {editing ? 'Cancel edit' : 'Edit output'}
            </button>
          </div>
          {editing ? (
            <textarea
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-border bg-background p-2 text-[12px] text-foreground"
            />
          ) : (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/40 p-2 text-[12px] text-foreground">
              {pending.outcome || '(no output produced at this step)'}
            </pre>
          )}
        </div>

        {/* Optional reviewer note (audited with the decision). */}
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Note (optional)</Label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why approve / reject…"
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
          />
        </div>

        {resolved ? (
          <p className="text-xs text-muted-foreground">
            Decision recorded: <span className="font-medium text-foreground">{resolved}</span>. Waiting for the
            run to advance…
          </p>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => decide('reject')}
              disabled={busy}
              className="gap-1.5 text-destructive"
            >
              <X className="size-4" /> Reject
            </Button>
            <Button onClick={() => decide('approve')} disabled={busy} className="gap-1.5">
              <Check className="size-4" weight="bold" /> {busy ? 'Applying…' : 'Approve'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
