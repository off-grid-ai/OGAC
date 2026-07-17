import { QueryConsole } from '@/components/data/QueryConsole';
import { starterQueriesFor } from '@/lib/dataplane-ui';
import { requireModuleForUser } from '@/lib/module-access';
import { currentOrgId } from '@/lib/tenancy';
import { profileForOrg } from '@/lib/tour-demo-seed';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

// Query console — the operator's read-only SQL surface over the warehouse (our "Athena"). Thin
// server shell (module guard) wrapping the interactive client console. The editor seeds from the
// `?sql=` param so "Query this table" deep-links land with the statement pre-filled. Starter
// queries are chosen for the active tenant's flavour (bank vs insurer) so the insurer tenant never
// sees bank-flavoured examples (transactions/NPA-loans/branches).
export default async function QueryPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ sql?: string }>;
}>) {
  await requireModuleForUser('data');
  const { sql = '' } = await searchParams;
  const flavour = profileForOrg(await currentOrgId()).flavour;
  return (
    <PageFrame>{<QueryConsole initialSql={sql} starters={starterQueriesFor(flavour)} />}</PageFrame>
  );
}
