'use client';

import {
  Check,
  CheckCircle,
  FileText,
  Info,
  Lock,
  Quotes,
  ShieldCheck,
  UserCircle,
  Warning,
  X,
  XCircle,
} from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { type ReviewDetail } from '@/lib/review-inbox';

// ─── ReviewDecision (HITL — screen 4 detail) — the reviewer's plain-language decision surface ─────
//
// A non-technical BFSI reviewer reads this and understands, in seconds: WHAT they are approving (the
// question + amount), WHAT the app recommends (the draft), WHY they can trust it (citations +
// faithfulness + guardrail/PII notes), the request itself (input), and WHY it needs a human (policy
// context). Then Approve / Reject.
//
// Approve/Reject POST to the EXISTING review route (/apps/runs/[id]/review) — the same durable-resume
// path. Approve respects approval authority: a 403 is surfaced as a calm notice ("above your
// authority — you can reject or escalate"), never a crash. Reject requires a reason.
export function ReviewDecision({
  detail,
  reviewable,
  runStatus,
}: {
  detail: ReviewDetail;
  reviewable: boolean;
  runStatus: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [resolved, setResolved] = useState<'approve' | 'reject' | null>(null);
  const [authBlocked, setAuthBlocked] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'reject') {
    if (busy) return;
    if (decision === 'reject' && !note.trim()) {
      toast.error('Please add a reason before rejecting.');
      return;
    }
    setBusy(decision);
    setAuthBlocked(null);
    try {
      const res = await fetch(
        `/api/v1/admin/apps/runs/${encodeURIComponent(detail.runId)}/review`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision, ...(note.trim() ? { note: note.trim() } : {}) }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        reason?: string;
      };
      if (res.status === 403) {
        // Under authority — surface calmly, don't pretend it worked.
        setAuthBlocked(data.reason ?? data.error ?? 'You are not authorized to approve this.');
        toast.error('This is above your approval authority.');
        return;
      }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'The decision could not be applied.');
        return;
      }
      setResolved(decision);
      toast.success(
        decision === 'approve' ? 'Approved — the run continues.' : 'Rejected — the run halts.',
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(null);
    }
  }

  const alreadyDecided = resolved !== null || !reviewable;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
      {/* ── LEFT: the decision, the draft, the why ── */}
      <div className="space-y-5">
        {/* The decision being asked. */}
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.05] p-5">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-500">
            <UserCircle className="size-4" weight="fill" /> {detail.appTitle} · needs your decision
          </div>
          <h1 className="mt-2 text-2xl font-semibold leading-tight text-foreground">
            {detail.question}
          </h1>
          {detail.amountLabel ? (
            <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
              {detail.amountLabel}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {detail.requestedBy ? (
              <span>
                Requested by <span className="text-foreground">{detail.requestedBy}</span>
              </span>
            ) : null}
            <span>
              Paused at <span className="text-foreground">{detail.stepLabel}</span>
            </span>
            {detail.startedAt ? (
              <span>{new Date(detail.startedAt).toLocaleString('en-IN')}</span>
            ) : null}
          </div>
        </div>

        {/* The draft the app recommends. */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="size-4 text-primary" /> What the app recommends
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 text-sm leading-relaxed text-foreground">
              {detail.draftOutput}
            </div>
          </CardContent>
        </Card>

        {/* WHY you can trust it — citations. */}
        {detail.citations.length > 0 ? (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Quotes className="size-4 text-primary" /> Where this came from
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                The sources the app used to write this. A supported source directly backs the answer.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {detail.citations.map((c, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-foreground">{c.title}</span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        c.supported
                          ? 'bg-primary/10 text-primary'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
                      }`}
                    >
                      {c.supported ? (
                        <>
                          <CheckCircle className="size-3" weight="fill" /> Supported
                        </>
                      ) : (
                        <>
                          <Warning className="size-3" /> Unverified
                        </>
                      )}
                      {c.scorePct !== null ? ` · ${c.scorePct}%` : ''}
                    </span>
                  </div>
                  {c.snippet ? (
                    <p className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">{c.snippet}</p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* ── RIGHT: trust signals, context, the actions ── */}
      <div className="space-y-5">
        {/* Trust: faithfulness + guardrail/PII notes. */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-primary" /> Trust checks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Faithful to sources</span>
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {detail.faithfulnessPct !== null ? `${detail.faithfulnessPct}%` : 'Not scored'}
                </span>
              </div>
              {detail.faithfulnessPct !== null ? (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      detail.faithfulnessPct >= 80
                        ? 'bg-primary'
                        : detail.faithfulnessPct >= 50
                          ? 'bg-amber-500'
                          : 'bg-destructive'
                    }`}
                    style={{ width: `${Math.max(3, detail.faithfulnessPct)}%` }}
                  />
                </div>
              ) : null}
            </div>
            {detail.guardrailNotes.length > 0 ? (
              <ul className="space-y-1.5">
                {detail.guardrailNotes.map((n, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <CheckCircle className="mt-0.5 size-3 shrink-0 text-primary" weight="fill" />
                    {n}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                No guardrail findings recorded for this draft.
              </p>
            )}
          </CardContent>
        </Card>

        {/* The request (input) + policy context. */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Info className="size-4 text-primary" /> The request
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.inputPairs.length > 0 ? (
              <dl className="divide-y divide-border/60 text-xs">
                {detail.inputPairs.map((p) => (
                  <div key={p.key} className="flex items-start justify-between gap-3 py-1.5">
                    <dt className="text-muted-foreground">{p.key}</dt>
                    <dd className="max-w-[60%] break-words text-right font-medium text-foreground">
                      {p.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[11px] text-muted-foreground">No input recorded.</p>
            )}
            <div className="rounded-md border border-border/60 bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Why this needs you
              </p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">{detail.policyContext}</p>
            </div>
          </CardContent>
        </Card>

        {/* The actions. */}
        <Card className="border-amber-500/40 shadow-sm">
          <CardContent className="space-y-3 pt-5">
            {resolved ? (
              <div className="flex items-center gap-2 rounded-md bg-muted/40 p-3 text-sm">
                {resolved === 'approve' ? (
                  <CheckCircle className="size-4 text-primary" weight="fill" />
                ) : (
                  <XCircle className="size-4 text-destructive" weight="fill" />
                )}
                <span className="text-foreground">
                  {resolved === 'approve'
                    ? 'Approved. The run is continuing.'
                    : 'Rejected. The run has been halted.'}
                </span>
              </div>
            ) : !reviewable ? (
              <div className="flex items-center gap-2 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                <Info className="size-4 shrink-0" />
                This run is {runStatus.replace('_', ' ')} — it is no longer awaiting a decision.
              </div>
            ) : (
              <>
                {!detail.canApprove ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3 text-xs">
                    <Lock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
                    <div>
                      <p className="font-medium text-foreground">Above your approval authority</p>
                      <p className="mt-0.5 text-muted-foreground">
                        {detail.approveBlockedReason ??
                          'You can reject or escalate this, but not approve it.'}
                      </p>
                    </div>
                  </div>
                ) : null}

                {authBlocked ? (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/[0.06] p-3 text-xs">
                    <Lock className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <p className="text-foreground">{authBlocked}</p>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Reason {detail.canApprove ? '(required to reject)' : '(required)'}
                  </Label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="Why are you approving or rejecting this?"
                    className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => decide('reject')}
                    disabled={busy !== null}
                    className="flex-1 gap-1.5 text-destructive"
                  >
                    <X className="size-4" /> {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                  </Button>
                  <Button
                    onClick={() => decide('approve')}
                    disabled={busy !== null || !detail.canApprove}
                    title={detail.canApprove ? undefined : 'Above your approval authority'}
                    className="flex-1 gap-1.5"
                  >
                    <Check className="size-4" weight="bold" />{' '}
                    {busy === 'approve' ? 'Approving…' : 'Approve'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
