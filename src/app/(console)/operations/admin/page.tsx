import { notFound, redirect } from 'next/navigation';
import { currentOrgId } from '@/lib/tenancy';
import { visibleDestinations } from '@/lib/tenancy-policy';
import {
  ADMIN_DESTINATIONS,
  type RouteSearchParams,
  withRouteSearchParams,
} from '@/lib/operations-destinations';

export default async function AdminRoot({
  searchParams,
}: Readonly<{ searchParams: Promise<RouteSearchParams> }>) {
  // Redirect to the first destination the CALLER may see. Using ADMIN_DESTINATIONS[0] blindly would be
  // fine today (Organization is first) but would silently send a tenant to an operator-only surface the
  // moment the array is reordered.
  const allowed = visibleDestinations(ADMIN_DESTINATIONS, await currentOrgId());
  if (allowed.length === 0) notFound();
  redirect(withRouteSearchParams(allowed[0].route, await searchParams));
}
