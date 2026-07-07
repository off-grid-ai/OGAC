import { notFound } from 'next/navigation';
import { PipelineQualityPanel } from '@/components/pipelines/governance/PipelineQualityPanel';
import { listEvalDefs } from '@/lib/eval-defs';
import { listGoldenCases } from '@/lib/evals';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Pipeline QUALITY tab — evals + golden set scoped to THIS pipeline (pipeline_id) ───────────────
// The corrected association: evals/golden belong to a PIPELINE (pipeline_id), not the app. This is
// the shipped app-Quality behaviour re-pointed to the pipeline entity. Its evals run in the
// pipeline's context and gate its releases; the org-wide library (unattached) is attachable here.
export default async function PipelineQualityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();

  const [evals, golden, libraryEvals] = await Promise.all([
    listEvalDefs({ pipelineId: id }),
    listGoldenCases({ pipelineId: id }),
    listEvalDefs({ pipelineId: null }), // org-wide library (unattached) — attachable to this pipeline
  ]);

  return (
    <PipelineQualityPanel
      pipelineId={p.id}
      pipelineName={p.name}
      evals={evals}
      golden={golden}
      libraryEvals={libraryEvals}
    />
  );
}
