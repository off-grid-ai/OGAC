import { FleetTopology } from '@/components/operations/FleetTopology';
import { requireModuleForUser } from '@/lib/module-access';

export default async function NodePage({
  params,
}: Readonly<{ params: Promise<{ nodeId: string }> }>) {
  await requireModuleForUser('gateway');
  const { nodeId } = await params;
  return <FleetTopology mode="node" resourceId={nodeId} />;
}
