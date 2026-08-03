import { ArrowRight, CheckCircle, Clock, Hourglass } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CaseDecision } from '@/components/build/CaseDecision';
import { PageFrame } from '@/components/PageFrame';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { buildAppDashboard } from '@/lib/app-dashboard';
import { isDeclinedByPerson } from '@/lib/app-run-progress';
import { listAppRuns } from '@/lib/app-run-store';
import {
  buildAppWorkQueue,
  caseLabel,
  caseRecommendation,
  caseTrail,
  NO_RECOMMENDATION,
  runSubject,
  statusLabel,
  type WorkRun,
} from '@/lib/app-work-queue';
import { getApp } from '@/lib/apps-store';
import { currentOrgId } from '@/lib/tenancy';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// ─── The app's landing screen: THE WORK ──────────────────────────────────────────────────────────
//
// An app automates a process the enterprise already runs, so work arrives on its own and the person
// using it opens the app to deal with what is waiting. This route used to land on Build — the app's own
// configuration — which made every app read as an entry in an AI console rather than the department's
// tool for that process (docs/APP_AS_PRODUCT.md item 3). Build now lives at ./build.
//
// Written for a non-technical reader and for READ-ONLY viewing: the public demo grants view access
// only, so every line states a fact about the work rather than instructing an action the viewer cannot
// take. All wording decisions live in the pure app-work-queue module.

function Row({
  run,
  href,
  icon,
  pendingStepId,
}: Readonly<{
  run: WorkRun;
  href: string;
  icon: React.ReactNode;
  /** Present on a waiting case: enables Approve / Reject without leaving the queue. */
  pendingStepId?: string | null;
}>) {
  // Formatted DETERMINISTICALLY, never with toLocaleString: that renders in the server's locale and
  // timezone and then again in the browser's, and the two disagree — which is exactly the hydration
  // mismatch (React #418) this page shipped with on first deploy.
  const recommendation = caseRecommendation(run.outcome);
  const parsed = Date.parse(run.startedAt);
  const when = Number.isNaN(parsed)
    ? null
    : `${new Date(parsed).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return (
    <Link
      href={href}
      className="block border-b border-border px-4 py-3 no-underline last:border-b-0 hover:bg-muted/40"
    >
      <span className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          {/* The subject gets the full row width and WRAPS. Putting the actions beside it truncated the
            case to "Training course reimbursement — V…", so you could not read what you were approving —
            a bad trade on the one screen where that matters most. Actions sit underneath instead. */}
          <span className="block text-sm leading-snug text-foreground">
            {caseLabel(run.subject, run.id)}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {statusLabel(run.status, { declined: run.declined })}
            {when ? ` · ${when}` : ''}
          </span>
          {/* The governed run, made visible. Derived from the run's own steps, so it never claims a check
            that did not happen. */}
          {(run as { trail?: string | null }).trail ? (
            <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/80">
              {(run as { trail?: string | null }).trail}
            </span>
          ) : null}
        </span>
        {pendingStepId ? null : (
          <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
        )}
      </span>
      {pendingStepId ? (
        <>
          {/* WHAT THE AI CONCLUDED. The row said "AI assessed it" beside Reject and Approve — it
              reported that an assessment happened and never what it decided, so the two most
              prominent controls on the screen asked for a judgement the reader had no basis to make.
              Where nothing was recorded we say that, rather than implying there is something to read. */}
          <span
            className={`mt-2 block text-xs leading-relaxed ${
              recommendation.text
                ? recommendation.leaning === 'decline'
                  ? 'text-destructive'
                  : recommendation.leaning === 'unclear'
                    ? 'text-amber-700 dark:text-amber-500'
                    : 'text-foreground'
                : 'text-muted-foreground'
            }`}
          >
            {recommendation.text ? (
              <>
                <b className="font-medium">The AI says:</b> {recommendation.text}
              </>
            ) : (
              NO_RECOMMENDATION
            )}
          </span>
          <span className="mt-2.5 flex items-center justify-between gap-3">
            {/* The row is a link, but the arrow above is suppressed to make room for the decision —
                so a waiting case was clickable with nothing to say so. This is that affordance. */}
            <span className="inline-flex items-center gap-1 text-xs text-primary underline">
              See the full case
              <ArrowRight className="size-3" />
            </span>
            <CaseDecision runId={run.id} stepId={pendingStepId} />
          </span>
        </>
      ) : null}
    </Link>
  );
}

export default async function AppWorkPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) notFound();

  const rows = await listAppRuns(id, orgId, 50).catch(() => []);
  // Shape is DERIVED from the spec: does any step pause for a person? A job-shaped app must not be told
  // that nothing is waiting for it (docs/APP_AS_PRODUCT.md §3b).
  const pausesForHuman = (app.steps ?? []).some((step) => step.kind === 'human');
  const queue = buildAppWorkQueue({
    trigger: app.trigger?.kind ?? 'on-demand',
    pausesForHuman,
    runs: rows.map((r) => ({
      id: r.id,
      status: String(r.status),
      startedAt:
        r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt ?? ''),
      // The run's own input IS the case, so the subject is derived from it. Without this every row
      // rendered the literal word "Case" and a queue of eight identical rows told the reader nothing.
      subject: runSubject((r as { input?: unknown }).input),
      // What actually happened to this case — the governed run made visible.
      trail: caseTrail((r as { steps?: { kind?: string; status?: string }[] }).steps, {
        signed: Boolean((r as { provenance?: unknown }).provenance),
      }),
      // The step awaiting a person — what an in-place decision has to target.
      pendingStepId:
        ((r as { steps?: { id?: string; status?: string }[] }).steps ?? []).find(
          (st) => st.status === 'awaiting_human',
        )?.id ?? null,
      // The model's own words, for the recommendation line on a waiting row.
      outcome: (r as { outcome?: string | null }).outcome ?? null,
      // A person declining a case halts the run the same way a failure does; only this tells them apart.
      declined: isDeclinedByPerson(
        (r as { steps?: { kind?: string; status?: string; detail?: string }[] }).steps,
      ),
    })),
  });

  // The NUMBERS live here too. They answer the same question as the queue — "what is happening with this
  // process" — so putting them on a separate Dashboard tab forced the reader to assemble one picture from
  // two screens. Same pure rule, rendered inline.
  const dashboard = buildAppDashboard({
    // Floored to the minute: a raw Date.now() can differ between the SSR pass and the RSC payload, and a
    // count or duration that lands either side of a boundary then renders two different strings — the
    // hydration mismatch (React #418) this screen hit on deploy. A minute is far finer than any figure here.
    nowMs: Math.floor(Date.now() / 60_000) * 60_000,
    runs: rows.map((r) => {
      const steps =
        (r as { steps?: { kind?: string; status?: string; startedAt?: string; finishedAt?: string }[] })
          .steps ?? [];
      return {
        status: String(r.status),
        startedAt:
          r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt ?? ''),
        finishedAt:
          (r as { finishedAt?: Date | string | null }).finishedAt instanceof Date
            ? ((r as { finishedAt: Date }).finishedAt).toISOString()
            : ((r as { finishedAt?: string | null }).finishedAt ?? null),
        neededPerson: steps.some((s) => s.kind === 'human' && s.status !== 'queued'),
        // Carried through so working time can be told apart from time spent waiting on a person.
        steps,
      };
    }),
  });

  const base = `/solutions/apps/${encodeURIComponent(id)}`;

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        {/* The headline DOMINATES. Everything else on this screen is context for it: what is waiting for
          you is the reason you opened the app, and it previously shared visual billing with "Needed a
          person 100%" — a number nobody acts on. */}
        <header>
          <h2 className="max-w-4xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {queue.headline}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{queue.howWorkArrives}</p>
        </header>

        {/* The numbers, then the work. One screen. */}
        {!queue.isEmpty ? (
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {dashboard.metrics.map((metric) => (
              <Card
                key={metric.label}
                className={cn(
                  'min-w-0 shadow-none',
                  // Only a number worth ACTING on gets weight. The rest recede — five equally loud stat
                  // boxes told the reader everything mattered the same, which is the same as telling them
                  // nothing does.
                  metric.tone === 'attention'
                    ? 'border-primary/40 bg-primary/[0.04]'
                    : 'border-border/60 bg-transparent',
                )}
              >
                <CardContent className="space-y-1 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {metric.label}
                  </p>
                  <p
                    className={cn(
                      'font-mono font-semibold tabular-nums',
                      metric.tone === 'attention'
                        ? 'text-2xl text-foreground'
                        : 'text-lg text-muted-foreground',
                    )}
                  >
                    {metric.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        {queue.isEmpty ? (
          <Card>
            <CardContent className="space-y-2 p-6">
              <p className="text-sm text-foreground">Nothing has come through yet.</p>
              <p className="max-w-2xl text-sm text-muted-foreground">
                When a case arrives it appears here, and anything needing a person&apos;s decision
                waits at the top of this list.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {queue.shape === 'job' && queue.waiting.length === 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-medium text-foreground">Run it</h3>
                <Card>
                  <CardContent className="space-y-3 p-5">
                    <p className="text-sm text-muted-foreground">
                      Nobody has to approve anything here. Run it and read the result.
                    </p>
                    <Button asChild size="sm">
                      <Link href={`${base}/input`}>
                        Run it now
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </section>
            ) : (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <Hourglass className="size-4 text-primary" />
                Waiting for a person
              </h3>
              <Card className="overflow-hidden p-0">
                {queue.waiting.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    Nothing is waiting on a decision right now.
                  </p>
                ) : (
                  queue.waiting.map((run) => (
                    <Row
                      key={run.id}
                      run={run}
                      href={`${base}/review`}
                      icon={<Clock className="size-4 text-primary" />}
                      pendingStepId={(run as { pendingStepId?: string | null }).pendingStepId}
                    />
                  ))
                )}
              </Card>
            </section>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <CheckCircle className="size-4 text-muted-foreground" />
                {queue.shape === 'job' ? 'Latest results' : 'Recently handled'}
              </h3>
              <Card className="overflow-hidden p-0">
                {queue.recent.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    Nothing has finished yet.
                  </p>
                ) : (
                  queue.recent.map((run) => (
                    <Row
                      key={run.id}
                      run={run}
                      href={`${base}/runs/${encodeURIComponent(run.id)}`}
                      icon={<CheckCircle className="size-4 text-muted-foreground" />}
                    />
                  ))
                )}
              </Card>
            </section>
          </div>
        )}
      </div>
    </PageFrame>
  );
}
