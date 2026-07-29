'use client';

import { Lightning, PencilSimple, ShareNetwork } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CockpitDashboard } from '@/components/app-use/CockpitDashboard';
import { RunPanel, type RunField } from '@/components/app-use/RunPanel';
import type { AppSurface } from '@/lib/app-surface';
import type { CockpitMetrics, TrendPoint } from '@/lib/cockpit-metrics';

type UseView = 'work' | 'dashboard' | 'run' | 'activity';

/** A case waiting on a person, and a headline stat — both computed by the pure rules on the server. */
export interface UseWaitingCase {
  id: string;
  label: string;
  href: string;
  when: string;
}
export interface UseStat {
  label: string;
  value: string;
  tone: 'neutral' | 'attention';
}

// ─── AppUseShell — the USE surface (the "deployed app you actually use") ───────────────────────────
// Distinct from the Studio BUILD surface (where you author the app). This is the Lovable/Bolt-style
// running app: a slim identity bar + a live dashboard, the run form, and activity — the same shell
// whether mounted in the console (admin surface) or on the org-gated shared link (shared surface).
// The active view lives in the URL (?view=) so Back is coherent and views are deep-linkable.
export function AppUseShell({
  title,
  summary,
  live,
  metrics,
  trend,
  fields,
  surface,
  editHref,
  waiting,
  workHeadline,
  stats,
}: Readonly<{
  title: string;
  summary: string;
  live: boolean;
  metrics?: CockpitMetrics | null;
  trend?: TrendPoint[];
  fields: RunField[];
  surface: AppSurface;
  editHref?: string;
  /**
   * WORK — the cases waiting on a person. This is the most important screen for the person who USES the
   * app, and the deployed surface had no equivalent: the queue existed only on the console side, so the
   * thing a team opens never said "here is what needs your decision".
   */
  waiting?: UseWaitingCase[];
  /** Headline sentence for the work view. */
  workHeadline?: string;
  /** The process's numbers, in the department's language. */
  stats?: UseStat[];
}>) {
  const pathname = usePathname();
  const params = useSearchParams();
  const hasDashboard = Boolean(metrics);
  const hasWork = Boolean(stats?.length || waiting?.length);
  const views: { key: UseView; label: string }[] = [
    // Work LEADS when there is anything to show: what is waiting for you comes before how to start
    // something new.
    ...(hasWork ? [{ key: 'work' as UseView, label: 'Work' }] : []),
    ...(hasDashboard ? [{ key: 'dashboard' as UseView, label: 'Dashboard' }] : []),
    { key: 'run', label: 'Run' },
    { key: 'activity', label: 'Activity' },
  ];
  const fallback: UseView = hasWork ? 'work' : hasDashboard ? 'dashboard' : 'run';
  const requested = (params.get('view') as UseView) || fallback;
  const view = views.some((v) => v.key === requested) ? requested : fallback;
  const hrefFor = (v: UseView) => (v === fallback ? pathname : `${pathname}?view=${v}`);

  const share = () => {
    if (typeof window !== 'undefined') {
      void navigator.clipboard.writeText(window.location.href).then(() => toast.success('Link copied'));
    }
  };

  return (
    <div className="w-full">
      {/* Identity bar */}
      <div className="mb-5 overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/[0.07] via-card to-card">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Lightning className="size-5" weight="duotone" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-foreground">{title}</h1>
              </div>
              {summary ? <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{summary}</p> : null}
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Off Grid AI · governed on-prem · PII masked
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={share}>
              <ShareNetwork className="size-4" /> Share
            </Button>
            {editHref ? (
              <Button variant="ghost" size="sm" className="gap-1.5" asChild>
                <Link href={editHref}>
                  <PencilSimple className="size-4" /> Edit
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
        {/* View tabs */}
        <div className="flex gap-1 border-t border-border/60 px-3">
          {views.map((v) => (
            <Link
              key={v.key}
              href={hrefFor(v.key)}
              className={`relative px-3 py-2.5 text-sm transition-colors ${
                view === v.key ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v.label}
              {view === v.key ? <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
            </Link>
          ))}
        </div>
      </div>

      {view === 'work' ? (
        <div className="space-y-5">
          {workHeadline ? (
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{workHeadline}</h2>
          ) : null}

          {stats?.length ? (
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className={`min-w-0 rounded-lg border p-4 ${
                    stat.tone === 'attention' ? 'border-primary/40' : 'border-border'
                  }`}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-foreground">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          <section>
            <h3 className="mb-2 text-sm font-medium text-foreground">Waiting for you</h3>
            <div className="overflow-hidden rounded-lg border border-border">
              {waiting?.length ? (
                waiting.map((c) => (
                  <a
                    key={c.id}
                    href={c.href}
                    className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 no-underline last:border-b-0 hover:bg-muted/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">{c.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{c.when}</span>
                    </span>
                  </a>
                ))
              ) : (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Nothing is waiting on a decision right now.
                </p>
              )}
            </div>
          </section>
        </div>
      ) : view === 'dashboard' && metrics ? (
        <CockpitDashboard metrics={metrics} trend={trend ?? []} live={live} customerHrefBase={surface.customerHrefBase} />
      ) : view === 'run' ? (
        <RunPanel fields={fields} surface={surface} />
      ) : (
        <ActivityEmpty />
      )}
    </div>
  );
}

function ActivityEmpty() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
      <p className="text-sm font-medium text-foreground">No runs yet</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        Runs you start (and the weekly report) will appear here with their governed trace and outcome.
      </p>
    </div>
  );
}
