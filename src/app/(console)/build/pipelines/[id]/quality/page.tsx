import { notFound } from 'next/navigation';
import { PipelineQualityPanel } from '@/components/pipelines/governance/PipelineQualityPanel';
import { listEvalDefs } from '@/lib/eval-defs';
import { listGoldenCases } from '@/lib/evals';
import { getPipeline } from '@/lib/pipelines';
import { listRollbackHistory } from '@/lib/pipeline-release';
import { FEEDBACK_SUITE } from '@/lib/feedback-map';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Pipeline QUALITY tab — evals + golden set scoped to THIS pipeline (pipeline_id) ───────────────
// The corrected association: evals/golden belong to a PIPELINE (pipeline_id), not the app. This is
// the shipped app-Quality behaviour re-pointed to the pipeline entity. Its evals run in the
// pipeline's context and gate its releases; the org-wide library (unattached) is attachable here.
//
// M1 close-the-loop: this tab now also shows the RELEASE GATE (publish-through-evals) + ROLLBACK
// history (last-good restores), and labels feedback-derived golden cases (source='feedback').
export default async function PipelineQualityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await currentOrgId();
  const p = await getPipeline(id, orgId);
  if (!p) notFound();

  const [evals, golden, libraryEvals, rollbacks] = await Promise.all([
    listEvalDefs({ pipelineId: id }),
    listGoldenCases({ pipelineId: id }),
    listEvalDefs({ pipelineId: null }), // org-wide library (unattached) — attachable to this pipeline
    listRollbackHistory(id, orgId),
  ]);

  const feedbackCount = golden.filter((g) => g.suite === FEEDBACK_SUITE).length;

  return (
    <PipelineQualityPanel
      pipelineId={p.id}
      pipelineName={p.name}
      status={p.status}
      version={p.version}
      evals={evals}
      golden={golden}
      libraryEvals={libraryEvals}
      rollbacks={rollbacks}
      feedbackCount={feedbackCount}
    />
  );
}
