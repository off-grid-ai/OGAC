import { ArrowLeft, Pulse } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { RunFailureBanner } from '@/components/build/RunFailureBanner';
import { AppRunStatus } from '@/components/build/AppRunStatus';
import { RunOutcomeEvidence } from '@/components/outcomes/RunOutcomeEvidence';
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
}: Readonly<{
  params: Promise<{ id: string; runId: string }>;
}>) {
  await requireModuleForUser('studio');
  const { id, runId } = await params;
  const orgId = await currentOrgId();
  const [app, run] = await Promise.all([getApp(id, orgId), getAppRunView(runId, orgId)]);
  if (!app || !run || run.appId !== app.id) notFound();

  return (
    <div className="w-full space-y-5">
      <div>
        <Link
          href={`/solutions/apps/${id}/runs`}
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All runs
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Pulse className="size-4" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{app.title}</h2>
            <p className="text-sm text-muted-foreground">
              Live status — watch each step execute, and approve or reject when it pauses for review.
            </p>
          </div>
        </div>
      </div>

      {/* WHY IT COULD NOT FINISH, FIRST. The page opened with the JSON below and a red chip, and the
          actual reason was engineer text buried one step down — so the owner of the process had to ask
          someone technical, the exact dependency the product claims to remove. */}
      {String(run.status) === 'error' ? (
        <RunFailureBanner steps={(run as { steps?: { label?: string; kind?: string; status?: string; detail?: string }[] }).steps} />
      ) : null}

      {Object.keys(run.input ?? {}).length > 0 ? (
        <details className="rounded-md border border-border bg-muted/30 p-3">
          {/* DEMOTED to a disclosure. A JSON blob is the first thing a business owner should never
              have to read, and it was the first thing on the page. */}
          <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground">
            What this case arrived with
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-foreground">
            {JSON.stringify(run.input, null, 2)}
          </pre>
        </details>
      ) : null}

      <AppRunStatus initial={run} />
      <RunOutcomeEvidence run={run} />
    </div>
  );
}
