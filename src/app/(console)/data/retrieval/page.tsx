import { RetrievalManager } from '@/components/retrieval/RetrievalManager';
import { requireModuleForUser } from '@/lib/module-access';
import { readRetrieval } from '@/lib/retrieval-view';
import { PageFrame } from '@/components/PageFrame';

export const dynamic = 'force-dynamic';

export async function RetrievalPageContent({
  basePath,
  embedded = false,
  showHeading = true,
}: Readonly<{ basePath?: string; embedded?: boolean; showHeading?: boolean }> = {}) {
  await requireModuleForUser('retrieval');
  const { data, error } = await readRetrieval();
  return (
    <PageFrame embedded={embedded}>
      <RetrievalManager
        basePath={basePath}
        initialView={data!}
        initialError={error}
        showHeading={showHeading}
      />
    </PageFrame>
  );
}

export default function RetrievalPage() {
  return <RetrievalPageContent />;
}
