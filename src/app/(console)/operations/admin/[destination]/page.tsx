import { notFound } from 'next/navigation';
import { AdminDestination } from '@/components/admin/AdminDestination';
import { requireModuleForUser } from '@/lib/module-access';
import { ADMIN_DESTINATIONS, operationsDestination } from '@/lib/operations-destinations';
import { currentOrgId } from '@/lib/tenancy';
import { visibleDestinations } from '@/lib/tenancy-policy';

export const dynamic = 'force-dynamic';

export default async function AdminDestinationPage({
  params,
}: Readonly<{ params: Promise<{ destination: string }> }>) {
  await requireModuleForUser('admin');
  const { destination: rawDestination } = await params;
  // Resolve against only the destinations THIS caller may see, so an operator-only surface
  // (tenant provisioning) is indistinguishable from a route that does not exist. Hiding the nav link
  // is presentation; this is the control.
  const allowed = visibleDestinations(ADMIN_DESTINATIONS, await currentOrgId());
  const destination = operationsDestination(allowed, rawDestination);
  if (!destination) notFound();
  return <AdminDestination destination={destination.id} />;
}
