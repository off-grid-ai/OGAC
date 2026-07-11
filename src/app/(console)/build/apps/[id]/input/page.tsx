import { notFound } from 'next/navigation';
import { AppInputForm } from '@/components/build/AppInputForm';
import { NeedsDataSourceBanner } from '@/components/build/NeedsDataSourceBanner';
import { Badge } from '@/components/ui/badge';
import { isSimpleAgent, unboundConnectorSteps, type AppStep } from '@/lib/app-model';
import { getApp } from '@/lib/apps-store';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// Plain-language, per-step "what happens" line for the non-technical operator — no engine names,
// no jargon. Pure mapping over the step kind (keeps the rail readable for a tax/claims user).
function describeStep(step: AppStep): string {
  const label = step.label?.trim();
  switch (step.kind) {
    case 'agent':
      return label || 'The assistant reads the request and drafts a result.';
    case 'connector-query':
      return label || 'Pulls the records this needs from your connected systems.';
    case 'guardrail':
      return label || 'Runs safety & compliance checks before continuing.';
    case 'human':
      return label || 'Pauses for a person to review and approve or reject.';
    case 'output':
      return label || 'Delivers the finished result (report or email).';
    default:
      return label || 'Runs a step.';
  }
}

// ─── Per-app INPUT tab (Builder Epic #116, screen 2) ──────────────────────────────────────────────
// The saved app's run surface: a structured input form from AppSpec.inputForm, submitted to the
// executor (POST /apps/[id]/run). A run that pauses at a human step surfaces on the Review tab.
// FULL-WIDTH (non-negotiable console rule): the form keeps a readable measure on the left, while a
// plain-language "what happens when you run this" rail fills the right on lg+, so a wide screen
// carries useful context instead of an empty gutter (gap G-WIDTH-1).
export default async function AppInputTab({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const app = await getApp(id, await currentOrgId());
  if (!app) notFound();

  const hasHumanStep = app.steps.some((s) => s.kind === 'human');
  const unboundSteps = unboundConnectorSteps(app);

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-foreground">Run {app.title}</h1>
        <Badge variant="secondary" className="bg-muted text-muted-foreground">
          {isSimpleAgent(app) ? 'agent' : `${app.steps.length} steps`}
        </Badge>
        <Badge variant="secondary" className="bg-muted text-muted-foreground">
          {app.trigger.kind}
        </Badge>
      </div>
      {app.summary ? <p className="text-sm text-muted-foreground">{app.summary}</p> : null}

      {unboundSteps.length > 0 ? (
        <NeedsDataSourceBanner appId={app.id} count={unboundSteps.length} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        {/* Left: the form, capped to a readable input measure inside the full-width grid cell. */}
        <div className="max-w-2xl">
          <AppInputForm app={app} />
        </div>

        {/* Right: plain-language walkthrough — uses the width, orients a non-technical operator. */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              What happens when you run this
            </p>
            <ol className="mt-3 space-y-3">
              {app.steps.map((step, i) => (
                <li key={step.id} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{describeStep(step)}</p>
                    {step.kind === 'human' ? (
                      <p className="mt-0.5 text-xs text-primary">You&apos;ll be asked to decide.</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
            {hasHumanStep ? (
              <p>
                This app pauses for a human decision. After you submit, the run shows up on the{' '}
                <span className="font-medium text-foreground">Review</span> tab for approval before
                it finishes.
              </p>
            ) : (
              <p>
                Every run is governed — inputs are checked, sources are cited, and the result is
                recorded on the <span className="font-medium text-foreground">Runs</span> tab.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
