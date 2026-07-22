import { PageFrame } from '@/components/PageFrame';
import { ServiceCapabilityExplorer } from '@/components/services/ServiceCapabilityExplorer';
import { requireModuleForUser } from '@/lib/module-access';
import { SERVICE_CAPABILITY_AUDITS } from '@/lib/service-capability-map';
import {
  isServiceInventoryAuditState,
  isServiceInventoryFamily,
  isServiceInventoryOwner,
  isServiceInventoryReadinessState,
  reconcileServiceInventory,
} from '@/lib/service-inventory';
import { listLiveServiceTopologies } from '@/lib/live-service-readiness';

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
  const rawAudit = typeof params.audit === 'string' ? params.audit : '';
  const rawReadiness = typeof params.readiness === 'string' ? params.readiness : '';
  const topology = await listLiveServiceTopologies();
  const inventory = reconcileServiceInventory({
    platformServices: topology.map((entry) => entry.service),
    topologies: topology,
  });

  return (
    <PageFrame>
      <ServiceCapabilityExplorer
        audits={SERVICE_CAPABILITY_AUDITS}
        inventory={inventory}
        inventoryFilter={{
          query: rawQuery,
          family: isServiceInventoryFamily(rawFamily) ? rawFamily : '',
          owner: isServiceInventoryOwner(rawOwner) ? rawOwner : '',
          audit: isServiceInventoryAuditState(rawAudit) ? rawAudit : '',
          readiness: isServiceInventoryReadinessState(rawReadiness) ? rawReadiness : '',
        }}
        selectedServiceId={selectedServiceId ?? null}
      />
    </PageFrame>
  );
}
