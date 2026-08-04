import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { AppUseShell } from '@/components/app-use/AppUseShell';
import { ViewerModeProvider } from '@/components/ViewerModeProvider';
import { CrossSellSourceUnavailable } from '@/components/app-use/CrossSellCustomerJourney';
import { CrossSellOpportunityQueue } from '@/components/app-use/CrossSellOpportunityQueue';
import type { RunField } from '@/components/app-use/RunPanel';
import { readBankCrossSellOpportunityBook } from '@/lib/adapters/bank-cross-sell-execution';
import { sharedSurface } from '@/lib/app-surface';
import { runInputPrompt } from '@/lib/app-input-prompt';
import { listAppRuns } from '@/lib/app-run-store';
import { buildAppDashboard } from '@/lib/app-dashboard';
import { isDeclinedByPerson } from '@/lib/app-run-progress';
import { buildAppWorkQueue, caseLabel, caseTrail, runSubject, statusLabel } from '@/lib/app-work-queue';
import { getAppBySlug } from '@/lib/apps-store';
import { resolveDeployedApp } from '@/lib/deployed-app';
import type { FormField } from '@/lib/app-model';

export const dynamic = 'force-dynamic';

// A DEPLOYED app served at /app/<slug> — the USE surface (the Lovable/Bolt-style running app you
// actually use, NOT the Studio build canvas). A published app renders its real running experience:
// a live dashboard, the run form (whatever inputs it declares), and governed actions. Unpublished
// slugs 404. Org-gating (only org members may open) is enforced upstream — see task: shared API.
export default async function DeployedAppPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const app = await getAppBySlug(slug);
  const resolved = resolveDeployedApp(app);
  if (!resolved || !app) notFound();

  // Cross-sell is the first reference solution: its USE surface is live enterprise context, not a
  // sample dashboard or a generic run form. Every other App retains the shared generated surface.
  const isCockpit = /cross[-\s]?sell/i.test(resolved.slug) || /cross[-\s]?sell/i.test(resolved.title);
  if (isCockpit) {
    // Same public-page reasoning as below: no actor, so the app's own org is the correct scope.
    const orgId = app.orgId;
    const book = await readBankCrossSellOpportunityBook(resolved.slug, orgId).catch(() => null);
    const rows =
      book?.opportunities.map((opportunity, index) => ({
        opportunity,
        evidence: book.evidence[index],
      })) ?? [];
    return (
      <main className="min-h-screen w-full bg-background px-4 py-6 md:px-8">
        <div className="w-full max-w-[110rem] space-y-5">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-primary">Live App</p>
              <h1 className="mt-2 text-2xl font-semibold text-foreground">{resolved.title}</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{resolved.summary}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Governed context → RM decision → CRM receipt → customer result
            </p>
          </header>
          {book ? (
            <CrossSellOpportunityQueue
              rows={rows}
              customerHrefBase={`/app/${encodeURIComponent(resolved.slug)}/customers/`}
            />
          ) : (
            <CrossSellSourceUnavailable />
          )}
        </div>
      </main>
    );
  }

  // THE APP'S OWN ORG, not the caller's.
  //
  // This page is PUBLIC — publishing is the opt-in — so there is no signed-in actor. currentOrgId()
  // resolves through bindTenantOrg, which correctly returns the ACTOR's org whenever it differs from
  // the host tenant (a viewer must never read another tenant's data). With no actor at all that lands
  // on 'default', so the page read runs for the wrong org and showed "No runs yet" while 18 real runs
  // sat under org_bharat. A right rule for authenticated surfaces, wrong for this one.
  //
  // The slug uniquely identifies ONE app row, and that row carries its org, so scoping to it is both
  // correct and non-leaking: there is no caller whose org could differ.
  const orgId = app.orgId;
  const runs = await listAppRuns(app.id, orgId, 500).catch(() => []);

  // A real previous case becomes the entry example, and the numbers come from the same pure rule the
  // console uses — so the deployed app has its own dashboard instead of `metrics={null}`.
  const exampleSubject =
    runs.map((r) => runSubject((r as { input?: unknown }).input)).find((x): x is string => Boolean(x)) ??
    null;
  const prompt = runInputPrompt({ trigger: app.trigger?.kind, exampleSubject });
  // The numbers and the waiting queue, from the SAME pure rules the console uses — so the deployed app
  // and the management view can never tell a different story about the same process.
  const nowMs = Math.floor(Date.now() / 60_000) * 60_000;
  const asWorkRuns = runs.map((r) => ({
    id: r.id,
    status: String(r.status),
    startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt ?? ''),
    subject: runSubject((r as { input?: unknown }).input),
    pendingStepId:
      ((r as { steps?: { id?: string; status?: string }[] }).steps ?? []).find(
        (st) => st.status === 'awaiting_human',
      )?.id ?? null,
    trail: caseTrail((r as { steps?: { kind?: string; status?: string }[] }).steps, {
      signed: Boolean((r as { provenance?: unknown }).provenance),
    }),
    // A person declining a case halts the run the same way a failure does; only this tells them apart.
    declined: isDeclinedByPerson(
      (r as { steps?: { kind?: string; status?: string; detail?: string }[] }).steps,
    ),
  }));
  const queue = buildAppWorkQueue({
    trigger: app.trigger?.kind ?? 'on-demand',
    pausesForHuman: (app.steps ?? []).some((st) => st.kind === 'human'),
    runs: asWorkRuns,
  });
  const dashboard = buildAppDashboard({
    nowMs,
    runs: runs.map((r) => {
      const steps = (r as { steps?: { kind?: string; status?: string }[] }).steps ?? [];
      return {
        status: String(r.status),
        startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt ?? ''),
        finishedAt:
          (r as { finishedAt?: Date | string | null }).finishedAt instanceof Date
            ? ((r as { finishedAt: Date }).finishedAt).toISOString()
            : ((r as { finishedAt?: string | null }).finishedAt ?? null),
        neededPerson: steps.some((st) => st.kind === 'human' && st.status !== 'queued'),
        declined: isDeclinedByPerson(steps),
      };
    }),
  });
  const fields = deriveRunFields(app.inputForm, prompt);
  const surface = sharedSurface(resolved.slug);
  // The read-only viewer's write controls must annotate themselves — that is the documented half of the
  // viewer policy ("the UI reads the role to disable/annotate write controls"). This surface sits OUTSIDE
  // the (console) layout, so it never got the provider, and the demo viewer was shown a full-strength
  // Approve button that answered 403 into a toast which then faded. A dead button is worse than no button.
  const session = await auth();

  return (
    <ViewerModeProvider role={session?.user?.role}>
    <div className="min-h-screen w-full bg-background px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-[100rem]">
        <AppUseShell
          title={resolved.title}
          summary={resolved.summary}
          live={false}
          metrics={null}
          trend={[]}
          fields={fields}
          surface={surface}
          appId={app.id}
          workHeadline={queue.headline}
          stats={dashboard.metrics.map((m) => ({ label: m.label, value: m.value, tone: m.tone }))}
          waiting={queue.waiting.map((c) => ({
            id: c.id,
            pendingStepId: (c as { pendingStepId?: string | null }).pendingStepId,
            trail: (c as { trail?: string | null }).trail,
            label: caseLabel(c.subject, c.id),
            href: `/app/${encodeURIComponent(resolved.slug)}?view=activity`,
            when: `${statusLabel(c.status, { declined: c.declined })} · ${
              Number.isNaN(Date.parse(c.startedAt))
                ? ''
                : `${new Date(Date.parse(c.startedAt)).toISOString().slice(0, 16).replace('T', ' ')} UTC`
            }`,
          }))}
        />
      </div>
    </div>
    </ViewerModeProvider>
  );
}

/**
 * The run fields for a deployed app.
 *
 * These used to fall back to a hard-coded CROSS-SELL form — "Customer segment: Priority/Salaried/SME/NRI",
 * "Minimum opportunity (₹)", "prioritise protection gaps for young families" — for every app that declared
 * no inputForm. So a Reimbursement app's deployed page asked a clerk for a customer segment and a minimum
 * ticket size. Nonsense for that process, and exactly the kind of thing that makes the product feel
 * unfinished.
 *
 * With no declared form we now ask for the ONE thing we can honestly ask for: the case itself, labelled and
 * exemplified from the app's own history (see src/lib/app-input-prompt.ts). No invented fields.
 */
function deriveRunFields(
  inputForm: FormField[] | undefined,
  prompt: { label: string; hint: string; placeholder: string },
): RunField[] {
  if (!inputForm || inputForm.length === 0) {
    return [
      {
        key: 'input',
        label: prompt.label,
        type: 'textarea',
        required: true,
        description: prompt.hint,
        placeholder: prompt.placeholder || undefined,
      },
    ];
  }
  return inputForm.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type === 'file' ? 'text' : (f.type as RunField['type']),
    required: f.required,
    options: f.options,
  }));
}
