import { notFound } from 'next/navigation';
import { PlatformHealthDestination } from '@/components/platform-health/PlatformHealthDestination';
import {
  HEALTH_DESTINATIONS,
  operationsDestination,
  type RouteSearchParams,
} from '@/lib/operations-destinations';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export default async function HealthDestinationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ destination: string }>;
  searchParams: Promise<RouteSearchParams>;
}>) {
  await requireModuleForUser('platform-health');
  const { destination: rawDestination } = await params;
  const destination = operationsDestination(HEALTH_DESTINATIONS, rawDestination);
  if (!destination) notFound();

  const query = await searchParams;
  const logsq = typeof query.logsq === 'string' ? query.logsq : query.logsq?.at(0);
  const svc = typeof query.svc === 'string' ? query.svc : query.svc?.at(0);
  return <PlatformHealthDestination destination={destination.id} logsq={logsq} svc={svc} />;
}
