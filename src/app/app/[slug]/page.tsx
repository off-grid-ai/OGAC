import { notFound } from 'next/navigation';
import { AppUseShell } from '@/components/app-use/AppUseShell';
import type { RunField } from '@/components/app-use/RunPanel';
import { sharedSurface } from '@/lib/app-surface';
import { getAppBySlug } from '@/lib/apps-store';
import { computeCockpitMetrics } from '@/lib/cockpit-metrics';
import { cockpitRows, cockpitTrend } from '@/lib/cockpit-fixtures';
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

  // The run form: whatever the app declares, else a sensible cross-sell default (never one bare box).
  const fields = deriveRunFields(app.inputForm);
  // Dashboard data: live from the bound data domain when present, else the deterministic sample.
  const metrics = computeCockpitMetrics(cockpitRows());

  return (
    <div className="min-h-screen w-full bg-background px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-[100rem]">
        <AppUseShell
          title={resolved.title}
          summary={resolved.summary}
          live={false}
          metrics={metrics}
          trend={cockpitTrend()}
          fields={fields}
          surface={sharedSurface(resolved.slug)}
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
