import { redirect } from 'next/navigation';
import {
  EDGE_DESTINATIONS,
  type RouteSearchParams,
  withRouteSearchParams,
} from '@/lib/operations-destinations';

export default async function EdgeRoot({
  searchParams,
}: Readonly<{ searchParams: Promise<RouteSearchParams> }>) {
  redirect(withRouteSearchParams(EDGE_DESTINATIONS[0].route, await searchParams));
}
