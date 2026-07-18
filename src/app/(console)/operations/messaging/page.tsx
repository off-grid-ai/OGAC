import { redirect } from 'next/navigation';
import {
  CONFIGURATION_DESTINATIONS,
  type RouteSearchParams,
  withRouteSearchParams,
} from '@/lib/operations-destinations';

export default async function LegacyMessagingPage({
  searchParams,
}: Readonly<{ searchParams: Promise<RouteSearchParams> }>) {
  redirect(withRouteSearchParams(CONFIGURATION_DESTINATIONS[3].route, await searchParams));
}
