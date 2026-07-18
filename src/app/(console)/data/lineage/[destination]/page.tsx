import { notFound } from 'next/navigation';
import { LineageDatasetCatalog } from '@/components/lineage/LineageCurate';
import { LineageGraph, LineageStoreUnavailable } from '@/components/lineage/LineageGraph';
import { LineageRuns } from '@/components/lineage/LineageRuns';
import { listAgentRuns } from '@/lib/agentrun';
import { readLineageView } from '@/lib/marquez';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { contextualDestination, contextualModule } from '@/modules/contextual-navigation';

export const dynamic = 'force-dynamic';

export default async function LineageDestinationPage({
  params,
}: Readonly<{ params: Promise<{ destination: string }> }>) {
  await requireModuleForUser('lineage');
  const { destination: rawDestination } = await params;
  const destination = contextualDestination(contextualModule('data-lineage'), rawDestination);
  if (!destination) notFound();

  if (destination.id === 'runs') {
    const orgId = await currentOrgId();
    const runs = await listAgentRuns(25, orgId).catch(() => []);
    return <LineageRuns runs={runs} />;
  }

  const lineage = await readLineageView();
  if (destination.id === 'graph') return <LineageGraph {...lineage} />;

  if (!lineage.configured || lineage.error) {
    return <LineageStoreUnavailable error={lineage.error} />;
  }

  return (
    <LineageDatasetCatalog
      datasets={lineage.data.datasets.map((dataset) => dataset.name)}
      activeNamespace={lineage.data.namespace}
    />
  );
}
