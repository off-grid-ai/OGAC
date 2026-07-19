import { PageFrame } from '@/components/PageFrame';
import { ServiceCapabilityMap } from '@/components/services/ServiceCapabilityMap';
import { requireModuleForUser } from '@/lib/module-access';
import { SERVICE_CAPABILITY_AUDITS } from '@/lib/service-capability-map';
import {
  isServiceInventoryFamily,
  isServiceInventoryOwner,
  reconcileServiceInventory,
} from '@/lib/service-inventory';
import { getRuntimeServiceTopologyRegistry } from '@/lib/runtime-service-topology';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ServiceCapabilityMapPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  await requireModuleForUser('services');
  const params = await searchParams;
  const rawService = params.service;
  const selectedServiceId =
    typeof rawService === 'string' ? rawService : Array.isArray(rawService) ? rawService[0] : null;
  const rawQuery = typeof params.q === 'string' ? params.q : '';
  const rawFamily = typeof params.family === 'string' ? params.family : '';
  const rawOwner = typeof params.owner === 'string' ? params.owner : '';
  const topology = getRuntimeServiceTopologyRegistry().list();
  const inventory = reconcileServiceInventory({
    platformServices: topology.map((entry) => entry.service),
    topologies: topology,
  });

  return (
    <PageFrame>
      <ServiceCapabilityMap
        audits={SERVICE_CAPABILITY_AUDITS}
        inventory={inventory}
        inventoryFilter={{
          query: rawQuery,
          family: isServiceInventoryFamily(rawFamily) ? rawFamily : '',
          owner: isServiceInventoryOwner(rawOwner) ? rawOwner : '',
        }}
        selectedServiceId={selectedServiceId ?? null}
      />
    </PageFrame>
  );
}
