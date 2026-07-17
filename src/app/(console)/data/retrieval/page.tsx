import { RetrievalManager } from '@/components/retrieval/RetrievalManager';
import { requireModuleForUser } from '@/lib/module-access';
import { readRetrieval } from '@/lib/retrieval-view';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

export default async function RetrievalPage() {
  await requireModuleForUser('retrieval');
  const { data, error } = await readRetrieval();
  return <PageFrame>{<RetrievalManager initialView={data!} initialError={error} />}</PageFrame>;
}
