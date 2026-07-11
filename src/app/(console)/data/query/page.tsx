import { QueryConsole } from '@/components/data/QueryConsole';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Query console — the operator's read-only SQL surface over the warehouse (our "Athena"). Thin
// server shell (module guard) wrapping the interactive client console. The editor seeds from the
// `?sql=` param so "Query this table" deep-links land with the statement pre-filled.
export default async function QueryPage({
  searchParams,
}: {
  searchParams: Promise<{ sql?: string }>;
}) {
  await requireModuleForUser('data');
  const { sql = '' } = await searchParams;
  return <QueryConsole initialSql={sql} />;
}
