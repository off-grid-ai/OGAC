import { notFound } from 'next/navigation';
import { AppQualityPanel } from '@/components/build/AppQualityPanel';
import { getApp } from '@/lib/apps-store';
import { listEvalDefs } from '@/lib/eval-defs';
import { listGoldenCases } from '@/lib/evals';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Per-app QUALITY tab (pipeline-owns-governance #154/#158) ─────────────────────────────────────
// The founder's ask made concrete: an eval / golden set / drift is owned BY a pipeline, not a floating
// global entity. This screen shows the evals + golden set THIS pipeline owns (app_id = this app), run
// in the pipeline's own context, plus the org-wide library you can attach from. Answers "where do I
// run it, how do I test it, what does it apply to" — it applies to THIS pipeline.
export default async function AppQualityTab({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) notFound();

  // RESOLVE THE PIPELINE ONCE, then query BOTH panels by it.
  //
  // This screen is titled "Evals for this pipeline" and "Golden set for this pipeline", and it was querying
  // both by APP id — so an app showed "0 attached" and "Golden set (0)" while the pipeline it runs on had
  // evals and golden cases sitting right there. Golden cases already existed for pipelines nobody had
  // touched and still displayed 0, which is how it was caught: the data was never missing, the filter was
  // asking the wrong question. A heading that says "pipeline" and a query that says "app" is the bug stated
  // in the UI.
  //
  // Falling back to the app id keeps an UNBOUND app working (it has no pipeline to ask about) and keeps any
  // app-scoped rows authored before this visible, so nothing already attached disappears.
  const scope = app.pipelineId?.trim()
    ? { pipelineId: app.pipelineId, appId: undefined }
    : { appId: id, pipelineId: undefined };
  const [evals, golden, libraryEvals] = await Promise.all([
    listEvalDefs(scope),
    listGoldenCases(scope),
    listEvalDefs(null), // org-wide library (unattached) — attachable to this pipeline
  ]);

  return (
    <AppQualityPanel
      appId={id}
      appTitle={app.title}
      evals={evals}
      golden={golden}
      libraryEvals={libraryEvals}
    />
  );
}
