import { PageFrame } from '@/components/PageFrame';
import { ServiceCapabilityMap } from '@/components/services/ServiceCapabilityMap';
import { requireModuleForUser } from '@/lib/module-access';
import { SERVICE_CAPABILITY_AUDITS } from '@/lib/service-capability-map';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ServiceCapabilityMapPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  await requireModuleForUser('services');
  const rawService = (await searchParams).service;
  const selectedServiceId =
    typeof rawService === 'string' ? rawService : Array.isArray(rawService) ? rawService[0] : null;

  return (
    <PageFrame>
      <ServiceCapabilityMap
        audits={SERVICE_CAPABILITY_AUDITS}
        selectedServiceId={selectedServiceId ?? null}
      />
    </PageFrame>
  );
}
