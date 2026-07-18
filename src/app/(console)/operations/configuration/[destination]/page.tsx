import { notFound } from 'next/navigation';
import { ConfigurationDestination } from '@/components/config/ConfigurationDestination';
import { requireModuleForUser } from '@/lib/module-access';
import { CONFIGURATION_DESTINATIONS, operationsDestination } from '@/lib/operations-destinations';

export const dynamic = 'force-dynamic';

export default async function ConfigurationDestinationPage({
  params,
}: Readonly<{ params: Promise<{ destination: string }> }>) {
  await requireModuleForUser('config');
  const { destination: rawDestination } = await params;
  const destination = operationsDestination(CONFIGURATION_DESTINATIONS, rawDestination);
  if (!destination) notFound();
  return <ConfigurationDestination destination={destination.id} />;
}
