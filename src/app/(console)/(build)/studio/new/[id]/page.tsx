import { ArrowLeft, PencilSimple } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { AppInputForm } from '@/components/build/AppInputForm';
import { getApp } from '@/lib/apps-store';
import { isSimpleAgent } from '@/lib/app-model';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── The INPUT screen (Builder Epic Phase 3A, screen 2 of 5) ──────────────────────────────────────
// The saved app's run surface: renders a structured input form from AppSpec.inputForm and runs the
// app inline (POST /apps/[id]/run → Phase 2A executor). Reached after "Save app" in the builder, and
// deep-linkable by id. Screens 3 (live status), 4 (review) and 5 (reports) are later phases — the
// run trace this screen shows already carries the per-step status those screens will stream/extend.
export default async function AppInputPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const app = await getApp(id, await currentOrgId());
  if (!app) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href="/studio/new"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          New app
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground">{app.title}</h1>
          <Badge variant="secondary" className="bg-muted text-muted-foreground">
            {isSimpleAgent(app) ? 'agent' : `${app.steps.length} steps`}
          </Badge>
          <Badge variant="secondary" className="bg-muted text-muted-foreground">
            {app.trigger.kind}
          </Badge>
          {app.published ? (
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              published
            </Badge>
          ) : null}
        </div>
        {app.summary ? <p className="mt-1 text-sm text-muted-foreground">{app.summary}</p> : null}
      </div>

      <AppInputForm app={app} />

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <PencilSimple className="size-3" />
        Editing the saved app (canvas + step edits) lands with the Phase 3B canvas — for now, rebuild
        from{' '}
        <Link href="/studio/new" className="text-primary hover:underline">
          New app
        </Link>
        .
      </p>
    </div>
  );
}
