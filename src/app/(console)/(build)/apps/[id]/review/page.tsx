import { ArrowRight, CheckCircle, UserCircle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { progress } from '@/lib/app-runs-view';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app REVIEW tab (Builder Epic #116, screen 4) ─────────────────────────────────────────────
// The HITL queue for this app: every run paused at a human step, awaiting a decision. Opening one
// goes to its run detail, where AppRunStatus inlines the AppReview surface (approve / reject / edit)
// that resumes the durable workflow. Scoped to the app id.
export default async function AppReviewTab({ params }: { params: Promise<{ id: string }> }) {
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
          <h1 className="text-lg font-semibold text-foreground">Review</h1>
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
            return (
              <Link
                key={r.id}
                href={`/apps/${id}/runs/${encodeURIComponent(r.id)}`}
                className="group flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.05] p-4 hover:border-amber-500/70"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-foreground">{r.id}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {p.done}/{p.total} steps
                  </span>
                </div>
                <p className="text-sm font-medium text-foreground">
                  {pending?.label ?? 'Awaiting decision'}
                </p>
                {pending?.outcome ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{pending.outcome}</p>
                ) : null}
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
