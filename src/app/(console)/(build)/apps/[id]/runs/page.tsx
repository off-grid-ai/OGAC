import { ArrowRight, Play, Pulse } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/build/AppRunStatus';
import { progress } from '@/lib/app-runs-view';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app RUNS tab (Builder Epic #116, screen 3) ───────────────────────────────────────────────
// This app's run history — newest first, scoped to the app id. Pick a run to watch it live (screen 3)
// or open a paused one to decide on it (screen 4). Links stay within the app shell (/apps/<id>/runs/…).
export default async function AppRunsTab({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const [app, runs] = await Promise.all([
    getApp(id, orgId),
    listAppRunsView(id, orgId, 100),
  ]);
  if (!app) notFound();
  const awaiting = runs.filter((r) => r.status === 'awaiting_human').length;

  return (
    <div className="w-full space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Pulse className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Runs</h1>
            <p className="text-sm text-muted-foreground">
              Every run of {app.title}.
              {awaiting > 0 ? (
                <span className="ml-1 text-amber-600 dark:text-amber-500">
                  {awaiting} awaiting review.
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <Link
          href={`/apps/${id}/input`}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Play className="size-4" weight="fill" />
          New run
        </Link>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Run</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Steps</th>
              <th className="px-3 py-2 font-medium">Started</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const p = progress(r.steps);
              return (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{r.id}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} small />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {p.done}/{p.total}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/apps/${id}/runs/${encodeURIComponent(r.id)}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {r.status === 'awaiting_human' ? 'Review' : 'Watch'}{' '}
                      <ArrowRight className="size-3" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No runs yet.{' '}
                  <Link href={`/apps/${id}/input`} className="text-primary hover:underline">
                    Run it
                  </Link>{' '}
                  to see live status here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
