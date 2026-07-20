import { FleetTopology } from '@/components/operations/FleetTopology';
import { requireModuleForUser } from '@/lib/module-access';

export default async function ClustersPage() {
  await requireModuleForUser('gateway');
  return <FleetTopology mode="clusters" />;
}
