import { notFound } from 'next/navigation';
import { PipelineRoutingEditor } from '@/components/pipelines/PipelineRoutingEditor';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Gateway & Routing tab — FUNCTIONAL edit of the gateway binding, egress leash, and hard data
// ceiling. Saving PATCHes the pipeline (bumps version + snapshot).
export default async function PipelineRoutingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();
  return (
    <PipelineRoutingEditor
      data={{
        id: p.id,
        gatewayId: p.gatewayId,
        defaultModel: p.defaultModel,
        egressAllowed: p.routing.egressAllowed !== false,
        dataAllowlist: p.dataAllowlist,
        ruleSummary: (p.routing.rules ?? []).map((r) => ({
          name: r.name,
          value: r.value,
          action: r.action,
        })),
      }}
    />
  );
}
