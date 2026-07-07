import { notFound } from 'next/navigation';
import { TabPlaceholder } from '@/components/pipelines/TabPlaceholder';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Observability tab — traces, latency, and token usage for THIS pipeline's runs. A lens over the
// pipeline's run stream, filled in the telemetry fan-out phase.
export default async function PipelineObservabilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();
  return (
    <TabPlaceholder title="Observability" pipelineName={p.name}>
      <p>
        Traces, latency, and token usage for every run that passed through this pipeline. A lens over
        the pipeline&apos;s run stream, filled in the telemetry fan-out.
      </p>
    </TabPlaceholder>
  );
}
