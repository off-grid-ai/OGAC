import { notFound } from 'next/navigation';
import { PipelineOverview } from '@/components/pipelines/PipelineOverview';
import { getPipeline } from '@/lib/pipelines';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The pipeline Overview tab (base route /pipelines/<id>). At-a-glance binding, data ceiling, status,
// and the publish action (which freezes an immutable version snapshot).
export default async function PipelineOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getPipeline(id, await currentOrgId());
  if (!p) notFound();
  return (
    <PipelineOverview
      pipeline={{
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        version: p.version,
        visibility: p.visibility,
        isTemplate: p.isTemplate,
        defaultModel: p.defaultModel,
        dataAllowlist: p.dataAllowlist,
        gateway: p.gateway ?? null,
      }}
    />
  );
}
