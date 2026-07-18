import { notFound } from 'next/navigation';
import { GatewayApiBudgetDestination } from '@/components/gateway/GatewayApiBudgetDestination';
import { requireModuleForUser } from '@/lib/module-access';
import { contextualDestination, contextualModule } from '@/modules/contextual-navigation';

export const dynamic = 'force-dynamic';

export default async function ApiBudgetDestinationPage({
  params,
}: Readonly<{ params: Promise<{ destination: string }> }>) {
  await requireModuleForUser('finops');
  const { destination: rawDestination } = await params;
  const destination = contextualDestination(
    contextualModule('runtime-api-budgets'),
    rawDestination,
  );
  if (!destination) notFound();

  return <GatewayApiBudgetDestination destination={destination.id} />;
}
