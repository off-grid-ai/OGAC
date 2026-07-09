import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { AppInputForm } from '@/components/build/AppInputForm';
import { NeedsDataSourceBanner } from '@/components/build/NeedsDataSourceBanner';
import { getApp } from '@/lib/apps-store';
import { isSimpleAgent, unboundConnectorSteps } from '@/lib/app-model';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app INPUT tab (Builder Epic #116, screen 2) ──────────────────────────────────────────────
// The saved app's run surface: a structured input form from AppSpec.inputForm, submitted to the
// executor (POST /apps/[id]/run). A run that pauses at a human step surfaces on the Review tab.
export default async function AppInputTab({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const app = await getApp(id, await currentOrgId());
  if (!app) notFound();

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

      <div className="max-w-3xl">
        <AppInputForm app={app} />
      </div>
    </div>
  );
}
