import { notFound } from 'next/navigation';
import { TabPlaceholder } from '@/components/pipelines/TabPlaceholder';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The API tab — the pipeline's own provisioned endpoint + key so apps, agents, and external
// third-parties can consume it as a governed contract. Wired in the provisioned-API fan-out phase.
export default async function PipelineApiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();
  return (
    <TabPlaceholder title="API — consume this pipeline" pipelineName={p.name}>
      <p>
        A provisioned endpoint + API key so apps, agents, and external third-parties can consume this
        pipeline as a governed contract — governance applies on every call. Mint/revoke keys land in
        the provisioned-API fan-out.
      </p>
    </TabPlaceholder>
  );
}
