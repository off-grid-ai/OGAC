import { notFound } from 'next/navigation';
import { AppUseShell } from '@/components/app-use/AppUseShell';
import { CrossSellSourceUnavailable } from '@/components/app-use/CrossSellCustomerJourney';
import { CrossSellOpportunityQueue } from '@/components/app-use/CrossSellOpportunityQueue';
import type { RunField } from '@/components/app-use/RunPanel';
import { readBankCrossSellOpportunityBook } from '@/lib/adapters/bank-cross-sell-execution';
import { sharedSurface } from '@/lib/app-surface';
import { runInputPrompt } from '@/lib/app-input-prompt';
import { listAppRuns } from '@/lib/app-run-store';
import { runSubject } from '@/lib/app-work-queue';
import { getAppBySlug } from '@/lib/apps-store';
import { resolveDeployedApp } from '@/lib/deployed-app';
import type { FormField } from '@/lib/app-model';
import { currentOrgId } from '@/lib/tenancy';

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
    const orgId = await currentOrgId();
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

  const orgId = await currentOrgId();
  const runs = await listAppRuns(app.id, orgId, 500).catch(() => []);

  // A real previous case becomes the entry example, and the numbers come from the same pure rule the
  // console uses — so the deployed app has its own dashboard instead of `metrics={null}`.
  const exampleSubject =
    runs.map((r) => runSubject((r as { input?: unknown }).input)).find((x): x is string => Boolean(x)) ??
    null;
  const prompt = runInputPrompt({ trigger: app.trigger?.kind, exampleSubject });
  // TODO(next): AppUseShell has no slot for a headline or stat band yet, so the deployed app still has
  // no dashboard of its own. Adding those props is the next real piece of work on this surface.
  const fields = deriveRunFields(app.inputForm, prompt);
  const surface = sharedSurface(resolved.slug);

  return (
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
        />
      </div>
    </div>
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
