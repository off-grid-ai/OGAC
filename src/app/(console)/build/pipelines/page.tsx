import { PipelinesManager, type PipelineCardData } from '@/components/pipelines/PipelinesManager';
import { listPipelines } from '@/lib/pipelines';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

// The Pipelines library surface (Gateways × Pipelines, the PIPELINE tier). Reusable, governed
// model-access contracts — the composition root apps/agents/chat consume. Full-width card grid;
// each card → a deep-linkable detail page.
export default async function PipelinesPage() {
  await requireModuleForUser('pipelines');
  const orgId = await currentOrgId();
  const rows = await listPipelines(orgId).catch(() => []);
  const pipelines: PipelineCardData[] = rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    version: p.version,
    isTemplate: p.isTemplate,
    dataAllowlist: p.dataAllowlist,
    gateway: p.gateway ?? null,
  }));
  return <PipelinesManager pipelines={pipelines} />;
}
