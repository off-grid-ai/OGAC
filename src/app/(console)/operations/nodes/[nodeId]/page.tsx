import { FleetTopology } from '@/components/operations/FleetTopology';
import { requireModuleForUser } from '@/lib/module-access';
import { PageFrame } from '@/components/PageFrame';

export default async function NodePage({
  params,
}: Readonly<{ params: Promise<{ nodeId: string }> }>) {
  await requireModuleForUser('gateway');
  const { nodeId } = await params;
  return <PageFrame>{<FleetTopology mode="node" resourceId={nodeId} />}</PageFrame>;
}
