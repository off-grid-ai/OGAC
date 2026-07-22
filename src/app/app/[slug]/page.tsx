import { notFound } from 'next/navigation';
import { AppUseShell } from '@/components/app-use/AppUseShell';
import { CrossSellOpportunityQueue } from '@/components/app-use/CrossSellOpportunityQueue';
import type { RunField } from '@/components/app-use/RunPanel';
import { readBankCrossSellOpportunityBook } from '@/lib/adapters/bank-cross-sell-execution';
import { sharedSurface } from '@/lib/app-surface';
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
    const book = await readBankCrossSellOpportunityBook(resolved.slug, orgId);
    const rows = book.opportunities.map((opportunity, index) => ({
      opportunity,
      evidence: book.evidence[index],
    }));
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
          <CrossSellOpportunityQueue
            rows={rows}
            customerHrefBase={`/app/${encodeURIComponent(resolved.slug)}/customers/`}
          />
        </div>
      </main>
    );
  }

  const fields = deriveRunFields(app.inputForm);
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

const DEFAULT_FIELDS: RunField[] = [
  {
    key: 'segment',
    label: 'Customer segment',
    type: 'select',
    required: true,
    options: ['Priority', 'Salaried', 'SME', 'NRI'],
    description: 'Which book of customers to generate next-best-actions for.',
  },
  {
    key: 'region',
    label: 'Region',
    type: 'select',
    options: ['All India', 'Mumbai', 'Delhi NCR', 'Bengaluru', 'Pune', 'Chennai', 'Hyderabad'],
  },
  {
    key: 'minPipeline',
    label: 'Minimum opportunity (₹)',
    type: 'number',
    placeholder: '100000',
    description: 'Only surface opportunities above this ticket size.',
  },
  {
    key: 'focus',
    label: 'Focus for this run',
    type: 'textarea',
    placeholder: 'e.g. prioritise protection gaps for young families',
  },
];

function deriveRunFields(inputForm: FormField[] | undefined): RunField[] {
  if (!inputForm || inputForm.length === 0) return DEFAULT_FIELDS;
  return inputForm.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type === 'file' ? 'text' : (f.type as RunField['type']),
    required: f.required,
    options: f.options,
  }));
}
