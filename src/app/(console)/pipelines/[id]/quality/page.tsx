import { notFound } from 'next/navigation';
import { TabPlaceholder } from '@/components/pipelines/TabPlaceholder';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Quality tab — evals + golden set run in THIS pipeline's context, gating releases. Wired in the
// quality fan-out phase (evals re-point to the pipeline entity).
export default async function PipelineQualityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();
  return (
    <TabPlaceholder title="Quality — evals & golden set" pipelineName={p.name}>
      <p>
        Evals and the golden set run in this pipeline&apos;s context and gate its releases. This tab
        fills in the quality fan-out, when evals re-point to the pipeline entity.
      </p>
    </TabPlaceholder>
  );
}
