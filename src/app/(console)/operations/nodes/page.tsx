import { FleetTopology } from '@/components/operations/FleetTopology';
import { requireModuleForUser } from '@/lib/module-access';
import { PageFrame } from '@/components/PageFrame';

export default async function NodesPage() {
  await requireModuleForUser('gateway');
  return <PageFrame>{<FleetTopology mode="nodes" />}</PageFrame>;
}
