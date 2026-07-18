import { notFound } from 'next/navigation';
import { EdgePanel } from '@/components/edge/EdgePanel';
import { requireModuleForUser } from '@/lib/module-access';
import { EDGE_DESTINATIONS, operationsDestination } from '@/lib/operations-destinations';

export const dynamic = 'force-dynamic';

export default async function EdgeDestinationPage({
  params,
}: Readonly<{ params: Promise<{ destination: string }> }>) {
  await requireModuleForUser('edge');
  const { destination: rawDestination } = await params;
  const destination = operationsDestination(EDGE_DESTINATIONS, rawDestination);
  if (!destination) notFound();
  return <EdgePanel destination={destination.id} />;
}
