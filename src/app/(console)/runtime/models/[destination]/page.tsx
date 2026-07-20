import { notFound } from 'next/navigation';
import { GatewayModelDestination } from '@/components/gateway/GatewayModelDestination';
import { requireModuleForUser } from '@/lib/module-access';
import { contextualDestination, contextualModule } from '@/modules/contextual-navigation';

export const dynamic = 'force-dynamic';

export default async function ModelDestinationPage({
  params,
}: Readonly<{ params: Promise<{ destination: string }> }>) {
  await requireModuleForUser('gateway');
  const { destination: rawDestination } = await params;
  const destination = contextualDestination(contextualModule('runtime-models'), rawDestination);
  if (!destination) notFound();

  return <GatewayModelDestination destination={destination.id} />;
}
