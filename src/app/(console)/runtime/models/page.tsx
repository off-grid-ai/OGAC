import { redirect } from 'next/navigation';
import { legacyGatewayRedirect, type LegacyGatewayQuery } from '@/modules/runtime-routes';

/** Land on Overview while preserving bookmarks from the former local gateway tabs. */
export default async function ModelsRoot({
  searchParams,
}: Readonly<{ searchParams: Promise<LegacyGatewayQuery> }>) {
  redirect(legacyGatewayRedirect(await searchParams));
}
