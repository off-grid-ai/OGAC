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
export default async function AppQualityTab({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleForUser('studio');
  const { id } = await params;
  const orgId = await currentOrgId();
  const app = await getApp(id, orgId);
  if (!app) notFound();

  const [evals, golden, libraryEvals] = await Promise.all([
    listEvalDefs(id),
    listGoldenCases(id),
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
