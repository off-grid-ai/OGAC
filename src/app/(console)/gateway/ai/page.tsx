import { redirect } from 'next/navigation';
import { legacyGatewayRedirect, type LegacyGatewayQuery } from '@/modules/runtime-routes';

/** Preserve old AI Gateway bookmarks while routing each former tab to its canonical owner. */
export default async function LegacyGatewayPage({
  searchParams,
}: Readonly<{ searchParams: Promise<LegacyGatewayQuery> }>) {
  redirect(legacyGatewayRedirect(await searchParams));
}
