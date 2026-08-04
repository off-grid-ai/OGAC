'use client';

import { Lightning, PencilSimple, ShareNetwork } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { CaseDecision } from '@/components/build/CaseDecision';
import { AppOwnerDashboard, type OwnerDashboardData } from '@/components/app-use/AppOwnerDashboard';
import { Markdown } from '@/components/Markdown';
import { Button } from '@/components/ui/button';
import { CockpitDashboard } from '@/components/app-use/CockpitDashboard';
import { RunPanel, type RunField } from '@/components/app-use/RunPanel';
import type { AppSurface } from '@/lib/app-surface';
import { statsForShape, showsWaitingQueue, type LatestResult } from '@/lib/app-front-door';
import type { Protection } from '@/lib/app-protections';
import type { AppShape } from '@/lib/app-work-queue';
import { utcStamp } from '@/lib/timestamp';
import type { CockpitMetrics, TrendPoint } from '@/lib/cockpit-metrics';

type UseView = 'work' | 'dashboard' | 'run' | 'activity';

/** A case waiting on a person, and a headline stat — both computed by the pure rules on the server. */
export interface UseWaitingCase {
  id: string;
  label: string;
  href: string;
  when: string;
  /** The step awaiting a person. Present ⇒ the case is decidable right here. */
  pendingStepId?: string | null;
  /** One line describing what already happened to this case — the governed run, made visible. */
  trail?: string | null;
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
  appId,
  activity,
  shape = 'queue',
  latest,
  howWorkArrives,
  owner,
  sourceWarning,
  protections,
}: Readonly<{
  /** Passed to the run panel so a case can be picked from the app's bound data. */
  appId?: string;
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
  /**
   * ACTIVITY — every case this app has handled, newest first.
   *
   * The Activity tab was hardcoded to an empty state: it rendered "No runs yet" unconditionally, having
   * never been passed a single run. The app had 18. An empty state that cannot be anything else is not
   * an empty state, it is a false statement.
   */
  activity?: UseActivityCase[];
  /**
   * Which shape of app this is. Derived by appShape (does any step pause for a person?), never
   * configured — see docs/APP_AS_PRODUCT.md §3b.
   *
   * A JOB is something people come and run to get results; nothing ever waits for a decision. Leading
   * such an app with "Waiting for you — nothing is waiting on a decision" answers a question nobody
   * asked, on a section that can never hold anything.
   */
  shape?: AppShape;
  /** For a job: what its last run produced. This is the reason the app exists. */
  latest?: LatestResult | null;
  /** One sentence: how this app is triggered ("Runs on a schedule", "Arrives by email"). */
  howWorkArrives?: string;
  /**
   * The generic app-owner dashboard — "is this working, and where is it going wrong?".
   *
   * Distinct from `metrics`, which drives CockpitDashboard: that is the bespoke RM cross-sell cockpit
   * (assets under management, a lead→won funnel), not something an ordinary app owner can read.
   */
  owner?: OwnerDashboardData | null;
  /**
   * "This app read no data on its last run" — or null when its reads are fine.
   *
   * The console-side page carried this and the deployed app did not, so the team who actually use the app
   * were the one group never told it is working from nothing.
   */
  sourceWarning?: string | null;
  /**
   * What protects this app, in plain language, from its own pipeline.
   *
   * These are the RULES IN FORCE, not evidence about any particular run — the panel says so. The
   * platform records a model name and nothing about where that model ran, so claiming "nothing left your
   * building" here would dress configuration up as proof.
   */
  protections?: Protection[];
}>) {
  const pathname = usePathname();
  const params = useSearchParams();
  const shownStats = statsForShape(shape, stats ?? []);
  const hasDashboard = Boolean(metrics) || Boolean(owner);
  const hasWork = Boolean(stats?.length || waiting?.length);
  // A job's front door already carries the run form, so a separate Run tab would be the same control in
  // two places — two things to keep working, and a reader wondering whether they differ.
  const runIsOnFrontDoor = shape === 'job' && hasWork;
  const views: { key: UseView; label: string }[] = [
    // Work LEADS when there is anything to show: what is waiting for you comes before how to start
    // something new. For a job it is labelled for what it holds — running it and its results — because
    // "Work" reads as a queue, which is exactly what this shape does not have.
    ...(hasWork
      ? [{ key: 'work' as UseView, label: shape === 'job' ? 'Overview' : 'Work' }]
      : []),
    ...(hasDashboard ? [{ key: 'dashboard' as UseView, label: 'Dashboard' }] : []),
    ...(runIsOnFrontDoor ? [] : [{ key: 'run' as UseView, label: 'Run' }]),
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
          {/* Above the headline: if the app is reading nothing, every number below it is about a process
              that has stopped receiving work, and reading them first would mislead. */}
          {sourceWarning ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
              {sourceWarning}
            </p>
          ) : null}
          {workHeadline ? (
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{workHeadline}</h2>
          ) : null}

          {/* Only the numbers that can ever be non-trivial for this shape. A permanently-zero figure is
              not neutral — it competes with the ones that matter and teaches the reader to skim past all
              of them. */}
          {shownStats.length ? (
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {shownStats.map((stat) => (
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

          {/* A JOB's front door leads with running it and with what it last produced — side by side, so a
              wide screen carries both instead of stacking one under the other. */}
          {shape === 'job' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-medium text-foreground">Run it now</h3>
                {howWorkArrives ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{howWorkArrives}</p>
                ) : null}
                <div className="mt-3">
                  {/* The SAME run panel the Run tab uses. The headline already promised "run it again any
                      time" and there was no way to do it from this screen; a second submit path here
                      would be a second thing to keep correct. */}
                  <RunPanel fields={fields} surface={surface} appId={appId} heading={null} />
                </div>
              </section>
              <section className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-medium text-foreground">What it produced last</h3>
                {latest ? (
                  <>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {utcStamp(latest.when)}
                    </p>
                    {latest.outcome ? (
                      // Rendered, not printed. The model writes markdown, so a raw dump put
                      // "**Retention Action Recommendation**" in front of a department reader — literal
                      // asterisks on the one panel that carries the app's whole value. Uses the shared
                      // Markdown component rather than a second renderer.
                      <div className="mt-2 max-h-[34rem] overflow-y-auto pr-1">
                        <Markdown>{latest.outcome}</Markdown>
                      </div>
                    ) : (
                      // Never a blank panel: a never-run job and a job whose last run failed are
                      // different situations and an empty box conflates them.
                      <p className="mt-2 text-sm text-muted-foreground">{latest.absence}</p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    This has not produced a result yet. Run it and the output will appear here.
                  </p>
                )}
              </section>
            </div>
          ) : null}

          {/* A queue app shows this even when empty — "nothing is waiting" is the answer to the question
              that screen exists to answer. A job app has no such question. */}
          {showsWaitingQueue(shape, waiting?.length ?? 0) ? (
          <section>
            <h3 className="mb-2 text-sm font-medium text-foreground">Waiting for you</h3>
            <div className="overflow-hidden rounded-lg border border-border">
              {waiting?.length ? (
                waiting.map((c) => (
                  // Anchored, because the waiting queue links here: a person following "this needs you" should
        // land ON their case, not at the top of every case the app has ever run.
        <div
          key={c.id}
          id={`case-${c.id}`}
          className="scroll-mt-24 border-b border-border px-4 py-3 last:border-b-0 target:bg-primary/5"
        >
                    <a href={c.href} className="block no-underline hover:opacity-80">
                      {/* Full width, wrapping: you must be able to read the case you are deciding. */}
                      <span className="block text-sm leading-snug text-foreground">{c.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{c.when}</span>
                      {c.trail ? (
                        <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/80">
                          {c.trail}
                        </span>
                      ) : null}
                    </a>
                    {/* THE QUEUE LIVES HERE. This is the surface a team opens, so deciding happens here
                      rather than in the console — see docs/APP_AS_PRODUCT.md on the duplicate Work screens. */}
                    {c.pendingStepId ? (
                      <div className="mt-2.5 flex justify-end">
                        <CaseDecision runId={c.id} stepId={c.pendingStepId} />
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  Nothing is waiting on a decision right now.
                </p>
              )}
            </div>
          </section>
          ) : null}

          {/* AFTER the queue. This shell's own rule is that what is waiting for you comes first;
              reassurance about the rules is worth reading second, not ahead of the work. */}
          {protections && protections.length > 0 ? (
            <section className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-medium text-foreground">What protects this</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The rules in force whenever this app runs — not a record of any one case.
              </p>
              <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {protections.map((p) => (
                  <li key={p.title} className="rounded-md border border-border/70 bg-muted/25 p-3">
                    <p className="text-xs font-medium text-foreground">
                      {p.title}
                      {/* "Cannot be turned off" is the strongest form of this and worth naming. */}
                      {p.locked ? (
                        <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wide text-primary">
                          always on
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{p.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : view === 'dashboard' && owner ? (
        <AppOwnerDashboard data={owner} />
      ) : view === 'dashboard' && metrics ? (
        <CockpitDashboard metrics={metrics} trend={trend ?? []} live={live} customerHrefBase={surface.customerHrefBase} />
      ) : view === 'run' ? (
        <RunPanel fields={fields} surface={surface} appId={appId} />
      ) : activity && activity.length > 0 ? (
        <ActivityList cases={activity} />
      ) : (
        <ActivityEmpty />
      )}
    </div>
  );
}

export interface UseActivityCase {
  id: string;
  /** What the case was about, in the author's words. */
  subject: string | null;
  /** Already in plain words — 'Completed', 'Waiting for you', 'Could not finish'. */
  status: string;
  /** ISO. */
  startedAt: string;
  /** The governed trail: what was read, checked, decided. */
  trail: string | null;
}

// Every case the app has handled. Deliberately the SAME wording the console uses for the same run —
// a deployed app and its management view must never describe one case two ways.
function ActivityList({ cases }: Readonly<{ cases: UseActivityCase[] }>) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {cases.map((c) => (
        // Anchored, because the waiting queue links here: a person following "this needs you" should
        // land ON their case, not at the top of every case the app has ever run.
        <div
          key={c.id}
          id={`case-${c.id}`}
          className="scroll-mt-24 border-b border-border px-4 py-3 last:border-b-0 target:bg-primary/5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-foreground">{c.subject ?? 'Unnamed case'}</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {c.status}
              {c.startedAt ? ` · ${utcStamp(c.startedAt)}` : ''}
            </p>
          </div>
          {c.trail ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{c.trail}</p>
          ) : null}
        </div>
      ))}
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
