import { redirect } from 'next/navigation';
import {
  CONFIGURATION_DESTINATIONS,
  type RouteSearchParams,
  withRouteSearchParams,
} from '@/lib/operations-destinations';

export default async function LegacyIntegrationsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<RouteSearchParams> }>) {
  redirect(withRouteSearchParams(CONFIGURATION_DESTINATIONS[2].route, await searchParams));
}
