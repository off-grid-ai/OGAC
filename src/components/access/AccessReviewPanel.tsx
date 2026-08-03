'use client';

import { CheckCircle, ShieldWarning, Warning } from '@phosphor-icons/react/dist/ssr';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  attentionFlags,
  reviewDueness,
  validateReview,
  type ReviewDecision,
  type ReviewSubject,
  type SubjectDecision,
} from '@/lib/access-review';
import { explainResponse } from '@/lib/api-failure';

const SELECT = 'h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm';

interface Draft {
  decision: ReviewDecision;
  reason: string;
  newRole: string;
}

// ─── Certify who should still have access ───────────────────────────────────────────────────────────
//
// Every access framework asks who last confirmed each person's access, and when. The console could
// list users and change roles but had no record that anyone had ever reviewed the list.
//
// Two things make this a real review rather than a rubber stamp: the rows that carry risk are called
// out and sorted first (a list where every row looks the same gets approved without being read), and
// submitting APPLIES the decisions — a revocation is performed, not just filed.
export function AccessReviewPanel({
  subjects,
  lastReviewedAt,
  lastReviewedBy,
  now,
  activityAvailable = true,
}: Readonly<{
  subjects: ReviewSubject[];
  lastReviewedAt: string | null;
  lastReviewedBy: string | null;
  /** Passed from the server so the flags don't shift between render and hydration. */
  now: string;
  /**
   * False when the activity ledger could not be read. Every row would then read "has never signed
   * in" — a fabricated finding — so the reviewer is told the signal is missing instead.
   */
  activityAvailable?: boolean;
}>) {
  const at = useMemo(() => new Date(now), [now]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ summary: string; applied: { email: string; action: string; ok: boolean; detail?: string }[] } | null>(null);

  // With no usage signal, dormancy flags would be invented — so only the role-based ones are shown.
  const flags = useMemo(
    () => (activityAvailable ? attentionFlags(subjects, at) : []),
    [subjects, at, activityAvailable],
  );
  const flagFor = (id: string) => flags.find((f) => f.userId === id);
  const dueness = useMemo(
    () => reviewDueness(lastReviewedAt ? new Date(lastReviewedAt) : null, at),
    [lastReviewedAt, at],
  );

  // Riskiest first — that ordering is the whole point.
  const ordered = useMemo(() => {
    const rank = (id: string) => {
      const f = flagFor(id);
      return f ? (f.severity === 'high' ? 0 : 1) : 2;
    };
    return [...subjects].sort((a, b) => rank(a.id) - rank(b.id) || a.email.localeCompare(b.email));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, flags]);

  const decisions: SubjectDecision[] = ordered
    .filter((s) => drafts[s.id])
    .map((s) => ({
      userId: s.id,
      email: s.email,
      decision: drafts[s.id].decision,
      reason: drafts[s.id].reason,
      newRole: drafts[s.id].newRole,
    }));

  const check = validateReview(subjects, decisions);

  function set(id: string, patch: Partial<Draft>) {
    setDrafts((d) => ({
      ...d,
      [id]: { ...{ decision: 'keep' as ReviewDecision, reason: '', newRole: '' }, ...d[id], ...patch },
    }));
  }

  async function submit() {
    setBusy(true);
    const res = await fetch('/api/v1/admin/access-reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decisions }),
    });
    setBusy(false);
    if (!res.ok) {
      const f = await explainResponse(res, 'record this access review');
      (f.refusal ? toast.info : toast.error)(f.message);
      return;
    }
    const data = (await res.json()) as { review?: { summary: string; applied: { email: string; action: string; ok: boolean; detail?: string }[] } };
    setDone({ summary: data.review?.summary ?? '', applied: data.review?.applied ?? [] });
    toast.success('Access review recorded');
  }

  if (done) {
    const failures = done.applied.filter((a) => !a.ok);
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            {failures.length ? (
              <Warning className="size-4 text-amber-600" weight="fill" />
            ) : (
              <CheckCircle className="size-4 text-primary" weight="fill" />
            )}
            Access review recorded
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{done.summary}</p>
          <ul className="space-y-1 text-xs">
            {done.applied.map((a) => (
              <li key={a.email} className={a.ok ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-500'}>
                · <span className="font-medium text-foreground">{a.email}</span> — {a.action}
                {a.ok ? '' : ` · DID NOT APPLY: ${a.detail ?? 'unknown reason'}`}
              </li>
            ))}
          </ul>
          {failures.length ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
              {failures.length} decision{failures.length === 1 ? '' : 's'} could not be applied. The
              record says so — it does not claim access was changed when it was not.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* IS ONE OWED? The never-reviewed case is stated plainly rather than dressed as "due in 90 days". */}
      <Card className={dueness.due ? 'border-amber-500/40 shadow-sm' : 'shadow-sm'}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-start gap-2">
            {dueness.due ? (
              <ShieldWarning className="mt-0.5 size-4 shrink-0 text-amber-600" weight="fill" />
            ) : (
              <CheckCircle className="mt-0.5 size-4 shrink-0 text-primary" weight="fill" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">{dueness.message}</p>
              <p className="text-xs text-muted-foreground">
                {lastReviewedBy
                  ? `Last certified by ${lastReviewedBy}.`
                  : 'An access review names a person who confirmed, one by one, that everyone on this list should still be here.'}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            {subjects.length} {subjects.length === 1 ? 'person' : 'people'}
          </Badge>
        </CardContent>
      </Card>

      {!activityAvailable ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          We could not read the activity record, so this review cannot tell you who has gone unused.
          You can still certify the list — but the &ldquo;not used for N days&rdquo; findings are
          missing, and we would rather say so than show every person as never having signed in.
        </p>
      ) : null}

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Confirm each person&apos;s access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ordered.map((s) => {
            const flag = flagFor(s.id);
            const d = drafts[s.id];
            return (
              <div
                key={s.id}
                className={`grid grid-cols-1 items-start gap-2 rounded-md border p-3 lg:grid-cols-[minmax(0,2fr)_auto_minmax(0,2fr)] ${
                  flag?.severity === 'high' ? 'border-destructive/40 bg-destructive/[0.04]' : 'border-border'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm text-foreground">{s.name || s.email}</p>
                    {/* THE ROLE, ON EVERY ROW. It is the thing being certified — it was only visible
                        on rows that happened to carry a role-based flag. */}
                    <Badge
                      variant="outline"
                      className={
                        s.role === 'admin'
                          ? 'shrink-0 border-destructive/50 bg-destructive/10 text-[10px] text-destructive'
                          : 'shrink-0 text-[10px]'
                      }
                    >
                      {s.role}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{s.email}</p>
                  {/* WHY THIS ROW DESERVES A LOOK. Without it every row reads the same and gets waved through. */}
                  {flag ? (
                    <p
                      className={`mt-1 text-[11px] ${
                        flag.severity === 'high'
                          ? 'font-medium text-destructive'
                          : 'text-amber-700 dark:text-amber-500'
                      }`}
                    >
                      {flag.why}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      {activityAvailable
                        ? 'Used recently — nothing unusual'
                        : 'Usage unknown'}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {(['keep', 'change-role', 'revoke'] as ReviewDecision[]).map((opt) => (
                    <Button
                      key={opt}
                      size="sm"
                      variant={
                        d?.decision === opt
                          ? opt === 'revoke'
                            ? 'destructive'
                            : 'default'
                          : 'outline'
                      }
                      onClick={() => set(s.id, { decision: opt })}
                      className="h-8 text-xs"
                    >
                      {opt === 'keep' ? 'Keep' : opt === 'revoke' ? 'Remove' : 'Change role'}
                    </Button>
                  ))}
                </div>
                <div className="min-w-0 space-y-1.5">
                  {d && d.decision !== 'keep' ? (
                    <>
                      {d.decision === 'change-role' ? (
                        <select
                          value={d.newRole}
                          onChange={(e) => set(s.id, { newRole: e.target.value })}
                          className={`${SELECT} w-full`}
                        >
                          <option value="">Move them to…</option>
                          <option value="admin">Admin — can change anything</option>
                          <option value="compliance">Compliance — can review, cannot change</option>
                          <option value="viewer">Viewer — read only</option>
                        </select>
                      ) : null}
                      {/* A decision that takes access away without a reason is not reviewable. */}
                      <Input
                        value={d.reason}
                        placeholder={
                          d.decision === 'revoke' ? 'Why are they losing access?' : 'Why the change?'
                        }
                        onChange={(e) => set(s.id, { reason: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/70">
                      {d ? 'Access confirmed as-is.' : 'No decision yet.'}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {check.ok ? (
            <span className="text-foreground">
              Ready to certify — {decisions.length} decision{decisions.length === 1 ? '' : 's'}.
              Removals and role changes are applied when you submit.
            </span>
          ) : (
            <ul className="space-y-0.5">
              {check.errors.map((e) => (
                <li key={e}>· {e}</li>
              ))}
            </ul>
          )}
        </div>
        <Button onClick={submit} disabled={busy || !check.ok} className="shrink-0">
          {busy ? 'Recording…' : 'Certify this access list'}
        </Button>
      </div>
    </div>
  );
}
