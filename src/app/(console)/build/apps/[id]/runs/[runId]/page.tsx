import { ArrowLeft, Pulse } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppRunStatus } from '@/components/build/AppRunStatus';
import { getAppRunView } from '@/lib/app-runs-view-reader';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app RUN detail (Builder Epic #116, screens 3 + 4) ────────────────────────────────────────
// The live status of one run of this app (AppRunStatus polls + inlines the Review surface when a
// human step pauses it). Deep-linkable within the app shell: /apps/<id>/runs/<runId>.
export default async function AppRunDetail({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  await requireModuleForUser('studio');
  const { id, runId } = await params;
  const orgId = await currentOrgId();
  const [app, run] = await Promise.all([getApp(id, orgId), getAppRunView(runId, orgId)]);
  if (!app || !run || run.appId !== app.id) notFound();

  return (
    <div className="w-full space-y-5">
      <div>
        <Link
          href={`/build/apps/${id}/runs`}
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All runs
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Pulse className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{app.title}</h1>
            <p className="text-sm text-muted-foreground">
              Live status — watch each step execute, and approve or reject when it pauses for review.
            </p>
          </div>
        </div>
      </div>

      {Object.keys(run.input ?? {}).length > 0 ? (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Run input</p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-foreground">
            {JSON.stringify(run.input, null, 2)}
          </pre>
        </div>
      ) : null}

      <AppRunStatus initial={run} />
    </div>
  );
}
