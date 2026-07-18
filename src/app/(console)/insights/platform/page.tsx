import { redirect } from 'next/navigation';
import { legacyHealthHref, type RouteSearchParams } from '@/lib/operations-destinations';

export default async function LegacyPlatformHealthPage({
  searchParams,
}: Readonly<{ searchParams: Promise<RouteSearchParams> }>) {
  redirect(legacyHealthHref(await searchParams));
}
