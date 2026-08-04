import { ArrowRight, CheckCircle, Clock, Play } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { PageFrame } from '@/components/PageFrame';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { readMyWork } from '@/lib/my-work-reader';
import { requireModuleForUser } from '@/lib/module-access';
import {
  buildMyWork,
  disambiguate,
  matchesQuery,
  overdueNote,
  waitedFor,
} from '@/lib/my-work';
import { auth } from '@/auth';
import { CoverPanel } from '@/components/work/CoverPanel';
import { slaStatus, slaWeight, summariseBreaches, type SlaRule } from '@/lib/case-sla';
import { slaRuleMap } from '@/lib/case-sla-store';
import { listCover } from '@/lib/cover-store';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── What needs me ──────────────────────────────────────────────────────────────────────────────────
//
// A department person's first question is "what needs me today?", and the product could only answer it
// one app at a time — with a dozen apps that meant opening a dozen pages. Worse, the section named
// "Work" held Chat, Projects, Prompts, Artifacts and Files, while the apps that do their actual job
// lived under "Solutions". Someone looking for their work would not look in a section named after a
// sales word, and the one named after their work did not contain it.
//
// This is that answer, first in the Work section. Pure logic in my-work.ts.
export default async function MyTasksPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ q?: string }> }>) {
  const { q = '' } = await searchParams;
  await requireModuleForUser('studio');
  const orgId = await currentOrgId();
  const now = new Date();
  // ONE read of "what is waiting for a person", shared with the home screen and the digest. This used to
  // be assembled here, again in the digest route, and a third time on the home — same rule, three copies.
  const { cases, summaries } = await readMyWork(orgId, now);

  // URL-driven, like every other filter here, so a search is shareable and Back steps out of it.
  const visible = cases.filter((c) => matchesQuery(c, q));
  const work = buildMyWork(visible, summaries, now);

  // HOW LATE IS IT. A case waiting ten minutes and one waiting ten days looked the same, so nothing ever
  // forced the pile to move. Targets are per app; an app with no target says so rather than being
  // reported as on time, which would invent a commitment the organisation never made.
  const slaRules = await slaRuleMap(orgId).catch(() => ({}) as Record<string, SlaRule>);
  const slaFor = (c: { appId: string; waitingSince: string }) =>
    slaStatus(c.waitingSince, slaRules[c.appId], now);
  const breaches = summariseBreaches(
    cases.map((c) => ({ appTitle: c.appTitle, status: slaFor(c) })),
  );

  // WHO IS COVERING. With no cover recorded, a person on leave means their cases sit unwatched — which
  // is what the ten-day-old cases on this tenant were. Best-effort: a failed read hides the panel rather
  // than blocking the queue, which is the more important thing on this page.
  const today = now.toISOString().slice(0, 10);
  const cover = await listCover(orgId).catch(() => null);
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role ?? '';
  const canEdit = role === 'admin' || role === 'compliance';

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
          <h1 className="text-xl font-semibold text-foreground">{work.headline}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {work.totalWaiting > 0
              ? 'Oldest first — the case that has waited longest is the one that needs you most.'
              : 'When something needs a person, it appears here.'}
          </p>
          </div>
          {/* FIND A CASE. Once something left the visible queue the only way back was scrolling. */}
          <form className="shrink-0">
            <input
              name="q"
              defaultValue={q}
              placeholder="Find a person, claim or app…"
              aria-label="Find a case"
              className="w-64 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </form>
        </div>

        {/* A search that hides work must say so, or an empty screen reads as "nothing needs you". */}
        {q.trim() ? (
          <p className="text-xs text-muted-foreground">
            Showing {visible.length} of {cases.length} waiting {cases.length === 1 ? 'case' : 'cases'}{' '}
            matching &ldquo;{q.trim()}&rdquo;.{' '}
            <Link href="/work/tasks" className="font-medium text-foreground underline">
              Show everything
            </Link>
          </p>
        ) : null}

        {/* Overdue work, and processes with no target at all — the second is why a pile grows unnoticed.
            Silent when there is nothing to say, so the banner keeps its meaning. */}
        {breaches.message ? (
          <div
            className={`rounded-md border p-3 text-xs ${
              breaches.overdue > 0
                ? 'border-destructive/40 bg-destructive/[0.05] text-foreground'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
            }`}
          >
            {breaches.message}
          </div>
        ) : null}

        {cover ? (
          <CoverPanel
            initial={cover.map((c) => ({
              id: c.id,
              away: c.away,
              coveredBy: c.coveredBy,
              from: c.from,
              until: c.until,
              note: c.note,
            }))}
            today={today}
            canEdit={canEdit}
          />
        ) : null}

        {work.groups.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {work.groups.map((g) => {
              const note = overdueNote(g);
              return (
                <Card key={g.appId} className={note ? 'border-amber-500/40 shadow-sm' : 'shadow-sm'}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-sm">
                        <Link
                          href={`/solutions/apps/${encodeURIComponent(g.appId)}`}
                          className="hover:text-primary hover:underline"
                        >
                          {g.appTitle}
                        </Link>
                      </CardTitle>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {g.cases.length} waiting
                      </Badge>
                    </div>
                    {/* Quiet when nothing is wrong: a row of green ticks trains people to stop reading. */}
                    {note ? (
                      <p className="text-[11px] text-amber-700 dark:text-amber-500">{note}</p>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {disambiguate(
                      [...g.cases].sort(
                        (a, b) => slaWeight(slaFor(a).state) - slaWeight(slaFor(b).state),
                      ),
                      now,
                    ).map(({ case: c, label }) => (
                      <Link
                        key={c.runId}
                        href={c.href}
                        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:border-primary/50 hover:bg-muted/40"
                      >
                        <span className="min-w-0">
                          {/* Never the run id: "Case proof_msd05iih" tells a person nothing they can act on.
                              Identical labels get their start time appended — three indistinguishable rows
                              is the failure a case subject exists to prevent. */}
                          <span className="block truncate text-sm text-foreground">{label}</span>
                          <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              waiting {waitedFor(c.waitingSince, now)}
                            </span>
                            {/* Against the promise, not just the clock. */}
                            {(() => {
                              const s = slaFor(c);
                              if (s.state === 'no-promise') return null;
                              return (
                                <span
                                  className={
                                    s.state === 'overdue'
                                      ? 'font-medium text-destructive'
                                      : s.state === 'due-soon'
                                        ? 'text-amber-700 dark:text-amber-500'
                                        : 'text-muted-foreground'
                                  }
                                >
                                  · {s.label}
                                </span>
                              );
                            })()}
                          </span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="shadow-sm">
            <CardContent className="flex items-center gap-2 py-5">
              <CheckCircle className="size-4 text-primary" weight="fill" />
              <p className="text-sm text-muted-foreground">
                Nothing is waiting for a decision right now.
              </p>
            </CardContent>
          </Card>
        )}

        {/* AND WHAT CAN I START? The other half of the question, and only published apps — sending
            someone to run a draft is a dead end. */}
        {work.idle.length > 0 ? (
          <div>
            <h2 className="text-sm font-semibold text-foreground">Ready when you need them</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing of yours is waiting in these — open one to start a case.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {work.idle.map((a) => (
                <Link
                  key={a.id}
                  href={`/solutions/apps/${encodeURIComponent(a.id)}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5 hover:border-primary/50 hover:bg-muted/40"
                >
                  <span className="truncate text-sm text-foreground">{a.title}</span>
                  <Play className="size-3.5 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {work.isEmpty ? (
          <Card className="shadow-sm">
            <CardContent className="py-5">
              <p className="text-sm text-muted-foreground">
                Nothing is set up for you yet. Someone who builds apps needs to publish one before work
                can reach you here.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageFrame>
  );
}
