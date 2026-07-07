import { notFound } from 'next/navigation';
import { TabPlaceholder } from '@/components/pipelines/TabPlaceholder';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Drift tab — quality drift computed over THIS pipeline's run history. Wired in the telemetry
// fan-out phase.
export default async function PipelineDriftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();
  return (
    <TabPlaceholder title="Drift" pipelineName={p.name}>
      <p>
        Quality and data drift over this pipeline&apos;s own run history. This is a lens over the
        pipeline&apos;s run stream, filled in the telemetry fan-out.
      </p>
    </TabPlaceholder>
  );
}
