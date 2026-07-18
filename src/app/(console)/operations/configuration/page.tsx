import { redirect } from 'next/navigation';
import {
  CONFIGURATION_DESTINATIONS,
  type RouteSearchParams,
  withRouteSearchParams,
} from '@/lib/operations-destinations';

export default async function ConfigurationRoot({
  searchParams,
}: Readonly<{ searchParams: Promise<RouteSearchParams> }>) {
  redirect(withRouteSearchParams(CONFIGURATION_DESTINATIONS[0].route, await searchParams));
}
