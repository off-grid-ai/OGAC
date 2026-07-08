import { ArrowRight, Pulse } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { StatusBadge } from '@/components/build/AppRunStatus';
import { progress } from '@/lib/app-runs-view';
import { listAppRunsView } from '@/lib/app-runs-view-reader';
import { listApps } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── App-runs list (Builder Epic Phase 4A) — the operator's entry to screens 3–4 ─────────────────
// Server-renders recent app-runs across the org (optionally filtered to ?appId=), newest first, so
// the operator can pick a run to watch (screen 3) or a paused run to decide on (screen 4). Filter is
// URL-driven (?appId=) so it is deep-linkable and Back-coherent.
export default async function AppRunsListPage({
  searchParams,
}: {
  searchParams: Promise<{ appId?: string }>;
}) {
  await requireModuleForUser('studio');
  const orgId = await currentOrgId();
  const { appId } = await searchParams;

  const [runs, apps] = await Promise.all([listAppRunsView(appId, orgId, 100), listApps(orgId)]);
  const appTitle = (id: string) => apps.find((a) => a.id === id)?.title ?? id;
  const awaiting = runs.filter((r) => r.status === 'awaiting_human').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Pulse className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">App runs</h1>
          <p className="text-sm text-muted-foreground">
            Multi-step app runs — watch one execute live, or open a run paused for human review.
            {awaiting > 0 ? (
              <span className="ml-1 text-amber-600 dark:text-amber-500">
                {awaiting} awaiting your review.
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {/* App filter chips (URL-driven). */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/build/apps/runs"
          className={`rounded-md border px-2 py-1 text-xs ${
            appId ? 'border-border text-muted-foreground' : 'border-primary/40 bg-primary/10 text-primary'
          }`}
        >
          All apps
        </Link>
        {apps.map((a) => (
          <Link
            key={a.id}
            href={`/build/apps/runs?appId=${encodeURIComponent(a.id)}`}
            className={`rounded-md border px-2 py-1 text-xs ${
              appId === a.id
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {a.title}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Run</th>
              <th className="px-3 py-2 font-medium">App</th>
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
                  <td className="px-3 py-2 text-foreground">{appTitle(r.appId)}</td>
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
                      href={`/build/apps/runs/${encodeURIComponent(r.id)}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {r.status === 'awaiting_human' ? 'Review' : 'Watch'} <ArrowRight className="size-3" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No runs yet. Run an app to see its live status here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
