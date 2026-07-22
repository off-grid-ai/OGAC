import { CollectionsManager } from '@/components/retrieval/CollectionsManager';
import { PageFrame } from '@/components/PageFrame';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

// Vector-store collections list → each opens a snapshot / disaster-recovery detail page.
export default async function CollectionsPage() {
  await requireModuleForUser('retrieval');
  return (
    <PageFrame>
      <CollectionsManager />
    </PageFrame>
  );
}
