import { notFound } from 'next/navigation';
import { PipelineDriftPanel } from '@/components/pipelines/governance/PipelineDriftPanel';
import { listEvalDefs } from '@/lib/eval-defs';
import { listEvalRuns } from '@/lib/evals';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// ─── Pipeline DRIFT tab — drift over THIS pipeline's eval-run history (Evidently presets) ──────────
// Drift is a lens over the pipeline's run stream. Honest empty state: drift needs a HISTORY of eval
// runs to split into baseline vs current windows, so we only enable the check once the pipeline has
// evals AND there is recorded run history — never a fabricated verdict. The check runs through the
// existing drift path (Evidently when configured, built-in PSI heuristic otherwise).
export default async function PipelineDriftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orgId = await currentOrgId();
  const p = await getPipeline(id, orgId);
  if (!p) notFound();

  const [evals, runs] = await Promise.all([
    listEvalDefs({ pipelineId: id }),
    listEvalRuns(20, orgId),
  ]);

  // Honest gate: drift needs a run history to compare. Require this pipeline to have evals AND at
  // least two recorded eval runs (a baseline + a current window to compare).
  const hasHistory = evals.length > 0 && runs.length >= 2;

  return (
    <PipelineDriftPanel
      pipelineId={p.id}
      pipelineName={p.name}
      hasHistory={hasHistory}
      evalCount={evals.length}
    />
  );
}
