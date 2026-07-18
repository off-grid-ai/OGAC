import { redirect } from 'next/navigation';
import { legacyHealthHref, type RouteSearchParams } from '@/lib/operations-destinations';

export default async function HealthRoot({
  searchParams,
}: Readonly<{ searchParams: Promise<RouteSearchParams> }>) {
  redirect(legacyHealthHref(await searchParams));
}
