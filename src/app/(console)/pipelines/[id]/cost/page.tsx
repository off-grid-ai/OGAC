import { notFound } from 'next/navigation';
import { TabPlaceholder } from '@/components/pipelines/TabPlaceholder';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Cost tab — spend attributed to THIS pipeline → its gateway/model. A lens over the run fact
// table (grouped by pipeline id), filled in the FinOps fan-out phase.
export default async function PipelineCostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();
  return (
    <TabPlaceholder title="Cost" pipelineName={p.name}>
      <p>
        Spend attributed to this pipeline, rolled up to its gateway and model. A lens over the run
        fact table grouped by pipeline id, filled in the FinOps fan-out.
      </p>
    </TabPlaceholder>
  );
}
