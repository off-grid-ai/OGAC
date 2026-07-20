import { notFound } from 'next/navigation';
import { AdminDestination } from '@/components/admin/AdminDestination';
import { requireModuleForUser } from '@/lib/module-access';
import { ADMIN_DESTINATIONS, operationsDestination } from '@/lib/operations-destinations';

export const dynamic = 'force-dynamic';

export default async function AdminDestinationPage({
  params,
}: Readonly<{ params: Promise<{ destination: string }> }>) {
  await requireModuleForUser('admin');
  const { destination: rawDestination } = await params;
  const destination = operationsDestination(ADMIN_DESTINATIONS, rawDestination);
  if (!destination) notFound();
  return <AdminDestination destination={destination.id} />;
}
