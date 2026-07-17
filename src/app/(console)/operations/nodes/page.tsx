import { FleetTopology } from '@/components/operations/FleetTopology';
import { requireModuleForUser } from '@/lib/module-access';

export default async function NodesPage() {
  await requireModuleForUser('gateway');
  return <FleetTopology mode="nodes" />;
}
