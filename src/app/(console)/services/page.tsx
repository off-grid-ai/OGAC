import { ServicesDirectory } from '@/components/services/ServicesDirectory';
import { requireModuleForUser } from '@/lib/module-access';
import { getServices } from '@/lib/services-directory';

export const dynamic = 'force-dynamic';

// Services directory — the map of every Off Grid surface (console, gateway, and the
// product subdomains) with live, server-probed health. The single place to see what
// we run and reach any of it, all behind the one console login.
export default async function ServicesPage() {
  await requireModuleForUser('services');
  return <ServicesDirectory services={getServices()} />;
}
