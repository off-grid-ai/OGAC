import { ServicesDirectory } from '@/components/services/ServicesDirectory';
import { requireModuleForUser } from '@/lib/module-access';
import { PageFrame } from '@/components/PageFrame';
import { toServiceTopologyDirectoryEntries } from '@/lib/service-directory-view';
import { listLiveServiceTopologies } from '@/lib/live-service-readiness';

export const dynamic = 'force-dynamic';

// Services directory — the map of every Off Grid AI surface (console, gateway, and the
// product subdomains) with live, server-probed health. The single place to see what
// we run and reach any of it, all behind the one console login.
export default async function ServicesPage() {
  await requireModuleForUser('services');
  const topologies = await listLiveServiceTopologies();
  return (
    <PageFrame>
      <ServicesDirectory services={toServiceTopologyDirectoryEntries(topologies)} />
    </PageFrame>
  );
}
