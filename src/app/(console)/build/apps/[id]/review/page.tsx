import { ArrowRight, CheckCircle, UserCircle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { progress } from '@/lib/app-runs-view';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { caseLabel, runSubject } from '@/lib/app-work-queue';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { recommendationFrom } from '@/lib/review-inbox';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app REVIEW tab (Builder Epic #116, screen 4) ─────────────────────────────────────────────
// The HITL queue for this app: every run paused at a human step, awaiting a decision. Opening one
// goes to its run detail, where AppRunStatus inlines the AppReview surface (approve / reject / edit)
// that resumes the durable workflow. Scoped to the app id.
export default async function AppReviewTab({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const [app, runs] = await Promise.all([
    getApp(id, orgId),
    listAppRunsView(id, orgId, 200),
  ]);
  if (!app) notFound();

  const awaiting = runs.filter((r) => r.status === 'awaiting_human');

  return (
    <div className="w-full space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-500">
          <UserCircle className="size-4" weight="fill" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Review</h2>
          <p className="text-sm text-muted-foreground">
            Runs of {app.title} paused for a human decision. Open one to approve, reject, or edit its
            output — the run resumes on your decision.
          </p>
        </div>
      </div>

      {awaiting.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border py-12 text-center">
          <CheckCircle className="size-8 text-primary" weight="fill" />
          <p className="text-sm text-muted-foreground">Nothing awaiting review. You&apos;re all caught up.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {awaiting.map((r) => {
            const p = progress(r.steps);
            const pending = r.steps.find((s) => s.status === 'awaiting_human');
            // WHAT the decision is about, not which row it is. This card led with the raw run id
            // (`apprun_54419080`) in mono type, so a reviewer facing a queue of them could not tell
            // which claim was theirs, spot the urgent one, or refer to one in a conversation — the
            // exact failure runSubject() was written for on the work queue. Reused here rather than
            // re-derived, so the two surfaces name the same case the same way.
            const subject = caseLabel(runSubject(r.input), r.id);
            // …and the app's own recommendation, which is the thing being approved. The card used
            // `pending.outcome`, but a HUMAN step has no outcome until it is decided, so every card
            // showed only its step label and no reviewer could see what they were approving.
            // recommendationFrom() already distils it from the upstream agent step for the review
            // detail; the queue card now agrees with the page it opens.
            const recommendation = recommendationFrom(r);
            return (
              <Link
                key={r.id}
                href={`/solutions/apps/${id}/runs/${encodeURIComponent(r.id)}`}
                className="group flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.05] p-4 hover:border-amber-500/70"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{subject}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {p.done}/{p.total} steps
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {pending?.label ?? 'Awaiting decision'}
                </p>
                <p className="line-clamp-3 whitespace-pre-line text-xs text-foreground/80">
                  {recommendation}
                </p>
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-600 group-hover:underline dark:text-amber-500">
                  Review now <ArrowRight className="size-3" />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
