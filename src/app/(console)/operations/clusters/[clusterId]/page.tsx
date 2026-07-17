import { FleetTopology } from '@/components/operations/FleetTopology';
import { requireModuleForUser } from '@/lib/module-access';
import { PageFrame } from '@/components/PageFrame';

export default async function ClusterPage({
  params,
}: Readonly<{ params: Promise<{ clusterId: string }> }>) {
  await requireModuleForUser('gateway');
  const { clusterId } = await params;
  return <PageFrame>{<FleetTopology mode="cluster" resourceId={clusterId} />}</PageFrame>;
}
