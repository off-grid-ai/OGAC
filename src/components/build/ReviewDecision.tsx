'use client';

import {
  ArrowBendUpRight,
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
import { ActionReviewEvidence } from '@/components/actions/ActionReviewEvidence';
import { Markdown } from '@/components/chat/Markdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { type ReviewDetail } from '@/lib/review-inbox';
import { snippetFields, snippetHeadline, snippetRowCount } from '@/lib/source-snippet';

// The reviewer's terminal decision — approve or reject.
// ROADMAP §10 Flow 6 step 4 names four: approve, EDIT, reject, ESCALATE. Two existed. The panel even
// told reviewers "you can reject or escalate this" beside two buttons — a capability claimed and not
// offered, which §11's honest-product-state rule forbids outright.
type ReviewOutcome = 'approve' | 'reject' | 'escalate';

// Pick one of three values by the run's decided outcome — approved / rejected / undecided.
// A tiny pure selector so the outcome→tone/label mappings read as flat lookups, not nested ternaries.
function byOutcome<T>(
  approved: boolean,
  rejected: boolean,
  whenApproved: T,
  whenRejected: T,
  otherwise: T,
): T {
  if (approved) return whenApproved;
  if (rejected) return whenRejected;
  return otherwise;
}

// Faithfulness meter fill colour by score band: ≥80 good, ≥50 caution, else poor.
function faithfulnessBarClass(pct: number): string {
  if (pct >= 80) return 'bg-primary';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-destructive';
}

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
}: Readonly<{
  detail: ReviewDetail;
  reviewable: boolean;
  runStatus: string;
}>) {
  const router = useRouter();
  const [note, setNote] = useState('');
  // EDIT: the reviewer's corrected version of what the app proposes to do. Empty means "approve as
  // proposed"; anything else is sent as the step's output, and the review route captures it as a
  // golden case, so a correction teaches the evaluation set instead of evaporating.
  const [edited, setEdited] = useState<string | null>(null);
  const [escalateTo, setEscalateTo] = useState('');
  const [busy, setBusy] = useState<ReviewOutcome | null>(null);
  const [resolved, setResolved] = useState<ReviewOutcome | null>(null);
  const [authBlocked, setAuthBlocked] = useState<string | null>(null);

  async function decide(decision: ReviewOutcome) {
    if (busy) return;
    if (decision === 'reject' && !note.trim()) {
      toast.error('Please add a reason before rejecting.');
      return;
    }
    if (decision === 'escalate' && !note.trim()) {
      toast.error('Say why you are escalating — the next reviewer needs to know.');
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
          body: JSON.stringify({
            decision,
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(decision === 'approve' && edited?.trim() ? { output: edited.trim() } : {}),
            ...(decision === 'escalate' && escalateTo.trim() ? { to: escalateTo.trim() } : {}),
          }),
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
      // An escalation is a HAND-OFF, not a resolution: the run stays paused, so the panel must not
      // present it as decided.
      if (decision !== 'escalate') setResolved(decision);
      toast.success(
        decision === 'approve'
          ? edited?.trim()
            ? 'Approved with your edit — the run continues with the corrected output.'
            : 'Approved — the run continues.'
          : decision === 'reject'
            ? 'Rejected — the run halts.'
            : 'Escalated — the run stays paused and the next reviewer sees your reason.',
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(null);
    }
  }

  const alreadyDecided = resolved !== null || !reviewable;

  // The header must reflect the run's REAL state, not stay stuck on "needs your decision" after a
  // decision already resumed + completed the run (gap G-HITL-3). Prefer the just-made decision
  // (`resolved`), else infer from the persisted terminal status when we land on an already-resolved
  // run: done → approved/completed, cancelled/error → rejected/halted.
  // Infer the outcome when we land on an already-resolved run: done → approve, cancelled/error → reject.
  function inferredOutcome(): ReviewOutcome | null {
    if (reviewable) return null;
    if (runStatus === 'done') return 'approve';
    if (runStatus === 'cancelled' || runStatus === 'error') return 'reject';
    return null;
  }
  const outcome: ReviewOutcome | null = resolved ?? inferredOutcome();
  const decidedApproved = outcome === 'approve';
  const decidedRejected = outcome === 'reject';
  const headerTone = byOutcome(
    decidedApproved,
    decidedRejected,
    'border-primary/40 bg-primary/[0.05]',
    'border-destructive/40 bg-destructive/[0.05]',
    'border-amber-500/40 bg-amber-500/[0.05]',
  );
  const eyebrowTone = byOutcome(
    decidedApproved,
    decidedRejected,
    'text-primary',
    'text-destructive',
    'text-amber-600 dark:text-amber-500',
  );
  const eyebrowLabel = byOutcome(
    decidedApproved,
    decidedRejected,
    'approved · the run has continued',
    'rejected · the run was halted',
    'needs your decision',
  );
  const amountTone = byOutcome(
    decidedApproved,
    decidedRejected,
    'text-primary',
    'text-destructive',
    'text-amber-700 dark:text-amber-400',
  );

  // min-w-0 on BOTH tracks. Without it a grid track refuses to shrink below its widest content, so the
  // long source rows in the left column pushed the DECISION column past the right edge — the buttons a
  // reviewer is here to press were literally off-screen at 1600px.
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
      {/* ── LEFT: the decision, the draft, the why ── */}
      <div className="min-w-0 space-y-5">
        {/* The decision being asked — or, once decided, its recorded outcome (state-aware header). */}
        <div className={`rounded-lg border p-5 ${headerTone}`}>
          <div
            className={`flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide ${eyebrowTone}`}
          >
            {outcome ? (
              decidedApproved ? (
                <CheckCircle className="size-4" weight="fill" />
              ) : (
                <Warning className="size-4" weight="fill" />
              )
            ) : (
              <UserCircle className="size-4" weight="fill" />
            )}{' '}
            {detail.appTitle} · {eyebrowLabel}
          </div>
          <h1 className="mt-2 text-2xl font-semibold leading-tight text-foreground">
            {detail.question}
          </h1>
          {detail.amountLabel ? (
            <p className={`mt-2 font-mono text-3xl font-bold tabular-nums ${amountTone}`}>
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
              {outcome ? 'Decision at' : 'Paused at'}{' '}
              <span className="text-foreground">{detail.stepLabel}</span>
            </span>
            {detail.startedAt ? (
              <span>{new Date(detail.startedAt).toLocaleString('en-US')}</span>
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
            {/* The app writes markdown, so the reviewer was reading '**41,346.44**' and '✅ **Answer:'
                on the surface where a decision gets made. Rendered with the same renderer chat uses. */}
            <div className="prose prose-sm max-w-none rounded-md border border-border/60 bg-muted/30 p-3 leading-relaxed dark:prose-invert">
              <Markdown>{detail.draftOutput}</Markdown>
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
                The sources the app used to write this. A supported source directly backs the
                answer.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {detail.citations.map((c, i) => (
                <div key={i} className="rounded-md border border-border/60 p-3">
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
                  {/* A source is EVIDENCE on this screen, so it is read, not dumped. When the snippet
                      carries a data row it renders as field/value pairs (the same humanised labels the
                      run trace uses); prose snippets are shown as prose. */}
                  {c.snippet ? (
                    (() => {
                      const fields = snippetFields(c.snippet);
                      const rows = snippetRowCount(c.snippet);
                      if (!fields.length) {
                        return (
                          <p className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">
                            {c.snippet}
                          </p>
                        );
                      }
                      return (
                        <div className="mt-1.5 space-y-1">
                          <p className="text-[11px] text-muted-foreground">
                            {snippetHeadline(c.snippet)}
                          </p>
                          <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                            {fields.map((f) => (
                              <div key={f.label} className="flex min-w-0 items-baseline gap-1.5">
                                <dt className="shrink-0 text-[11px] text-muted-foreground">
                                  {f.label}
                                </dt>
                                <dd className="min-w-0 truncate text-[11px] font-medium text-foreground">
                                  {f.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          {rows && rows > 1 ? (
                            <p className="text-[10px] text-muted-foreground">
                              First of {rows} rows — the full set is on the run trace.
                            </p>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* ── RIGHT: trust signals, context, the actions ── */}
      <div className="min-w-0 space-y-5">
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
                    className={`h-full rounded-full ${faithfulnessBarClass(detail.faithfulnessPct)}`}
                    style={{ width: `${Math.max(3, detail.faithfulnessPct)}%` }}
                  />
                </div>
              ) : null}
              {/* A number under a heading called "Trust checks", surrounded by green ticks, does not
                  tell a reviewer that 40% is BAD. Say it in words at the point of decision — §11's
                  honest-state rule is about not implying a control is working when it is not. */}
              {detail.faithfulnessPct !== null && detail.faithfulnessPct < 50 ? (
                <p className="mt-1.5 text-[11px] text-destructive">
                  Weakly grounded — much of this answer is not directly supported by the sources below.
                  Read them before approving.
                </p>
              ) : null}
              {detail.faithfulnessPct === null ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Not scored — grounding was not measured for this run, so treat the answer as unchecked
                  rather than as verified.
                </p>
              ) : null}
            </div>
            {detail.guardrailNotes.length > 0 ? (
              <ul className="space-y-1.5">
                {detail.guardrailNotes.map((n, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                  >
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
                {detail.inputPairs.map((p) => {
                  // A value that is itself a JSON object ("Case: {\"fy\":\"2025-2026\",…}") was printed
                  // verbatim, so the request panel showed a wall of JSON next to the decision buttons.
                  // Same treatment as the sources: readable fields, one per line.
                  const nested = snippetFields(p.value, 10);
                  if (nested.length) {
                    return (
                      <div key={p.key} className="py-1.5">
                        <dt className="mb-1 text-muted-foreground">{p.key}</dt>
                        <dd className="space-y-0.5">
                          {nested.map((f) => (
                            <div key={f.label} className="flex items-baseline justify-between gap-3">
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {f.label}
                              </span>
                              <span className="min-w-0 truncate text-right text-[11px] font-medium text-foreground">
                                {f.value}
                              </span>
                            </div>
                          ))}
                        </dd>
                      </div>
                    );
                  }
                  return (
                    <div key={p.key} className="flex items-start justify-between gap-3 py-1.5">
                      <dt className="text-muted-foreground">{p.key}</dt>
                      <dd className="max-w-[60%] break-words text-right font-medium text-foreground">
                        {p.value}
                      </dd>
                    </div>
                  );
                })}
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

        <ActionReviewEvidence
          impact={detail.actionImpact}
          receipt={detail.actionReceipt}
          canApprove={detail.canApprove}
          boundaryReady={detail.actionBoundaryReady}
        />

        {/* The actions. */}
        <Card className="border-amber-500/40">
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
                {/* WHY THIS REACHED YOU. An escalated item that looks like every other item makes the
                    hand-off worthless — the reason the last reviewer could not decide is the first thing
                    the next one needs. */}
                {detail.escalations.length ? (
                  <div className="rounded-md border border-primary/40 bg-primary/[0.06] p-3 text-xs">
                    <p className="font-medium text-foreground">
                      Escalated to you{detail.escalations.length > 1 ? ` · ${detail.escalations.length} hand-offs` : ''}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {detail.escalations.map((e) => (
                        <li key={`${e.at}-${e.from}`} className="text-muted-foreground">
                          <span className="text-foreground">{e.from}</span>
                          {e.to ? ` → ${e.to}` : ' → a higher authority'} — {e.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {!detail.canApprove ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.06] p-3 text-xs">
                    <Lock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
                    <div>
                      <p className="font-medium text-foreground">
                        {detail.actionBoundaryReady === false
                          ? 'Connection needs attention'
                          : 'Above your approval authority'}
                      </p>
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

                {/* EDIT — Flow 6 step 4's second verb. A reviewer who mostly agrees should not have to
                    reject and start again: correct the wording, approve the corrected version, and the
                    correction becomes a golden case for the next evaluation run. */}
                {detail.canApprove ? (
                  edited === null ? (
                    <button
                      type="button"
                      onClick={() => setEdited(detail.draftOutput ?? '')}
                      className="self-start text-xs text-primary underline decoration-dotted underline-offset-2"
                    >
                      Edit what this will do before approving
                    </button>
                  ) : (
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Your corrected version
                      </Label>
                      <textarea
                        value={edited}
                        onChange={(e) => setEdited(e.target.value)}
                        rows={6}
                        className="w-full rounded-md border border-primary/40 bg-background p-2 font-mono text-xs text-foreground"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-muted-foreground">
                          Approving sends this instead, and keeps it as a correction to learn from.
                        </p>
                        <button
                          type="button"
                          onClick={() => setEdited(null)}
                          className="text-[11px] text-muted-foreground underline"
                        >
                          Discard edit
                        </button>
                      </div>
                    </div>
                  )
                ) : null}

                {/* ESCALATE — a hand-off, not a decision. Offered to EVERY reviewer, because the person
                    who most needs it is the one who cannot approve. */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Escalate to (optional)
                  </Label>
                  <input
                    value={escalateTo}
                    onChange={(e) => setEscalateTo(e.target.value)}
                    placeholder="A person, role or team — e.g. regional.credit@bharatunion.co.in"
                    className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => decide('reject')}
                    disabled={busy !== null}
                    className="min-w-[8rem] flex-1 gap-1.5 text-destructive"
                  >
                    <X className="size-4" /> {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => decide('escalate')}
                    disabled={busy !== null}
                    className="min-w-[8rem] flex-1 gap-1.5"
                    title="Hand this decision on — the run stays paused"
                  >
                    <ArrowBendUpRight className="size-4" />{' '}
                    {busy === 'escalate' ? 'Escalating…' : 'Escalate'}
                  </Button>
                  <Button
                    onClick={() => decide('approve')}
                    disabled={busy !== null || !detail.canApprove}
                    title={detail.canApprove ? undefined : 'Above your approval authority'}
                    className="min-w-[8rem] flex-1 gap-1.5"
                  >
                    <Check className="size-4" weight="bold" />{' '}
                    {busy === 'approve'
                      ? 'Approving…'
                      : edited?.trim()
                        ? 'Approve with edit'
                        : 'Approve'}
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
