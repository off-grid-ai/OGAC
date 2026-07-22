import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TemplateAdoptForm } from '@/components/build/TemplateAdoptForm';
import { PageFrame } from '@/components/PageFrame';
import { getApp, getTemplate } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── SOP template DETAIL — the deep-linkable adoption surface ──────────────────────────────────────
// A real detail page (its own route), not a modal: shows the published workflow's summary, its
// variables, and its step graph (when the viewer owns the template's org). "Use this template" opens
// the variable form (URL-driven via ?adopt=1) → POSTs to /use → clone engine instantiates it into
// the caller's org, binding the values. Adoption is Back-coherent (the form is a URL state).
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ adopt?: string }>;
};

const STEP_LABELS: Record<string, string> = {
  agent: 'AI agent',
  'connector-query': 'Data lookup',
  guardrail: 'Governance check',
  human: 'Human approval',
  output: 'Send / output',
};

export default async function TemplateDetailPage({ params, searchParams }: Props) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const { adopt } = await searchParams;
  const orgId = await currentOrgId();

  const template = await getTemplate(id, orgId);
  if (!template) notFound();
  // The full graph is visible only to the owning org (cross-org adopters instantiate, not preview).
  const spec = template.orgId === orgId ? await getApp(id, orgId) : null;
  const adopting = adopt === '1';

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <Link
          href="/solutions/templates"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Template library
        </Link>

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          {/* ── Left: the workflow ── */}
          <div className="space-y-6">
            <header>
              <p className="text-[10px] uppercase tracking-widest text-primary">
                {template.visibility === 'public' ? 'Public template' : 'Org template'} ·{' '}
                {template.stepCount} {template.stepCount === 1 ? 'step' : 'steps'}
              </p>
              <h1 className="mt-1 text-xl font-semibold">{template.title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {template.summary || 'No description provided.'}
              </p>
            </header>

            <section className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-medium">Workflow</h2>
              {spec ? (
                <ol className="mt-3 space-y-2">
                  {spec.steps.map((step, i) => (
                    <li key={step.id} className="flex items-baseline gap-3 text-sm">
                      <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                      <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {STEP_LABELS[step.kind] ?? step.kind}
                      </span>
                      <span className="text-foreground">{step.label || step.id}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  This template’s {template.stepCount}-step workflow is published by another team.
                  Adopt it to instantiate the full workflow into your workspace, then open it to
                  review and edit the steps.
                </p>
              )}
            </section>

            <section className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-medium">Variables you fill in</h2>
              {template.templateVars.vars.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  This template has no variables — it’s adopted exactly as published.
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {template.templateVars.vars.map((v) => (
                    <li key={v.name} className="flex flex-wrap items-baseline gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary">
                        {`{{${v.name}}}`}
                      </code>
                      <span className="text-[10px] uppercase text-muted-foreground">{v.type}</span>
                      {v.required ? (
                        <span className="text-[10px] uppercase text-amber-600 dark:text-amber-500">
                          required
                        </span>
                      ) : null}
                      {v.description ? (
                        <span className="text-xs text-muted-foreground">— {v.description}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* ── Right: adopt ── */}
          <aside className="space-y-4">
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-sm font-medium">Adopt this workflow</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Instantiate a private copy in your workspace. You fill in the variables; the workflow
                is cloned and bound to your values — no rebuilding.
              </p>
              <TemplateAdoptForm
                templateId={template.id}
                title={template.title}
                vars={template.templateVars.vars}
                adopting={adopting}
              />
            </div>
          </aside>
        </div>
      </div>
    </PageFrame>
  );
}
