import { ArrowRight, CheckCircle, Clock, Hourglass } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageFrame } from '@/components/PageFrame';
import { Card, CardContent } from '@/components/ui/card';
import { listAppRuns } from '@/lib/app-run-store';
import { buildAppWorkQueue, runSubject, statusLabel, type WorkRun } from '@/lib/app-work-queue';
import { getApp } from '@/lib/apps-store';
import { currentOrgId } from '@/lib/tenancy';

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
}: Readonly<{ run: WorkRun; href: string; icon: React.ReactNode }>) {
  // Formatted DETERMINISTICALLY, never with toLocaleString: that renders in the server's locale and
  // timezone and then again in the browser's, and the two disagree — which is exactly the hydration
  // mismatch (React #418) this page shipped with on first deploy.
  const parsed = Date.parse(run.startedAt);
  const when = Number.isNaN(parsed)
    ? null
    : `${new Date(parsed).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return (
    <Link
      href={href}
      className="flex items-start gap-3 border-b border-border px-4 py-3 no-underline last:border-b-0 hover:bg-muted/40"
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">
          {run.subject?.trim() || 'Case'}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {statusLabel(run.status)}
          {when ? ` · ${when}` : ''}
        </span>
      </span>
      <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
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
  const queue = buildAppWorkQueue({
    trigger: app.trigger?.kind ?? 'on-demand',
    runs: rows.map((r) => ({
      id: r.id,
      status: String(r.status),
      startedAt:
        r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt ?? ''),
      // The run's own input IS the case, so the subject is derived from it. Without this every row
      // rendered the literal word "Case" and a queue of eight identical rows told the reader nothing.
      subject: runSubject((r as { input?: unknown }).input),
    })),
  });

  const base = `/solutions/apps/${encodeURIComponent(id)}`;

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <header>
          <h2 className="text-xl font-semibold tracking-tight">{queue.headline}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{queue.howWorkArrives}</p>
        </header>

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
                    />
                  ))
                )}
              </Card>
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <CheckCircle className="size-4 text-muted-foreground" />
                Recently handled
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
