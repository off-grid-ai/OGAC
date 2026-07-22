import { ArrowRight, Stack } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { PageFrame } from '@/components/PageFrame';
import { listTemplates } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── SOP / workflow-template LIBRARY (list) — the cross-team reuse surface ─────────────────────────
// One team publishes a working multi-step app as a reusable SOP; another team adopts it here instead
// of rebuilding it from scratch. Full-width responsive grid of template cards → each opens a real,
// deep-linkable detail route (/solutions/templates/[id]) with the workflow, its variables, and a
// "Use this template" action. Read-only list; publishing/unpublishing is done from the app's own shell.
export default async function TemplateLibraryPage() {
  await requireModuleForUser('studio');
  const orgId = await currentOrgId();
  const templates = await listTemplates(orgId);

  return (
    <PageFrame>
      <div className="w-full space-y-6">
        <header>
          <p className="text-[10px] uppercase tracking-widest text-primary">Reusable SOPs</p>
          <h1 className="mt-1 text-xl font-semibold">Template library</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Workflows one team built and published so another team can adopt them in minutes — no
            rebuilding. Open a template to see its steps and the values you fill in, then adopt it
            into your own workspace. Publish your own from any app’s screen (“Publish as template”).
          </p>
        </header>

        {templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 p-12 text-center">
            <Stack className="size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No templates published yet</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              Build an app, then use “Publish as template” on its screen to share it here so other
              teams can adopt it. This kills duplicate work across teams.
            </p>
            <Link
              href="/solutions/apps"
              className="mt-4 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
            >
              Go to apps
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {templates.map((t) => (
              <Link
                key={t.id}
                href={`/solutions/templates/${t.id}`}
                className="group flex flex-col rounded-lg border bg-card p-5 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-widest text-primary">
                    {t.visibility === 'public' ? 'Public' : 'My org'} · {t.stepCount}{' '}
                    {t.stepCount === 1 ? 'step' : 'steps'}
                  </span>
                  <ArrowRight className="mt-0.5 size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </div>
                <h2 className="mt-2 font-medium">{t.title}</h2>
                <p className="mt-1 line-clamp-3 flex-1 text-sm text-muted-foreground">
                  {t.summary || 'No description.'}
                </p>
                <div className="mt-4 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                  {t.templateVars.vars.length > 0 ? (
                    <span>
                      {t.templateVars.vars.length}{' '}
                      {t.templateVars.vars.length === 1 ? 'variable' : 'variables'} to fill in
                    </span>
                  ) : (
                    <span>Adopt as-is (no variables)</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageFrame>
  );
}
