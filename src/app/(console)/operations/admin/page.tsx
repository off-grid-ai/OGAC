import { redirect } from 'next/navigation';
import {
  ADMIN_DESTINATIONS,
  type RouteSearchParams,
  withRouteSearchParams,
} from '@/lib/operations-destinations';

export default async function AdminRoot({
  searchParams,
}: Readonly<{ searchParams: Promise<RouteSearchParams> }>) {
  redirect(withRouteSearchParams(ADMIN_DESTINATIONS[0].route, await searchParams));
}
