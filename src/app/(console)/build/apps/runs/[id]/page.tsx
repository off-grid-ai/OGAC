import { ArrowLeft, Pulse } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppRunStatus } from '@/components/build/AppRunStatus';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── App-run detail (Builder Epic Phase 4A) — RUNNING (screen 3) + REVIEW (screen 4) ──────────────
// Server-renders the current app_runs row (the initial live snapshot) and hands it to AppRunStatus,
// which polls for updates while the run is open and inlines the REVIEW surface when a human step
// pauses it. Deep-linkable: /apps/runs/<id> is the run's address (nav lives in the URL).
export default async function AppRunPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const run = await getAppRunView(id, orgId);
  if (!run) notFound();

  const app = await getApp(run.appId, orgId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/build/apps/runs"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All runs
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Pulse className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {app?.title ?? 'App run'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Live status of this run — watch each step execute, and approve or reject when a step
              pauses for human review.
            </p>
          </div>
        </div>
      </div>

      <AppRunStatus initial={run} />
    </div>
  );
}
