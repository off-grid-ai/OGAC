import { notFound } from 'next/navigation';
import { PageFrame } from '@/components/PageFrame';
import { PayloadIndexManager } from '@/components/retrieval/PayloadIndexManager';
import { SnapshotManager } from '@/components/retrieval/SnapshotManager';
import { requireModuleForUser } from '@/lib/module-access';
import { validateCollectionName } from '@/lib/qdrant-snapshots';

export const dynamic = 'force-dynamic';

// Collection detail: live health, snapshot (backup/DR) management, and the FILTER INDEXES for one vector
// collection. The indexes sit here because they are a property of this collection, and because the thing
// they fix is invisible without a surface: every governed retrieval filters on org_id and the deployed
// collection had no index for it, so that filter was answered by scanning every point.
export default async function CollectionDetailPage({
  params,
}: Readonly<{ params: Promise<{ name: string }> }>) {
  await requireModuleForUser('retrieval');
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  if (!validateCollectionName(decoded).ok) notFound();
  return (
    <PageFrame>
      {/* Snapshots first — backup/DR is what an operator opens this page for. Indexes are the tuning
          concern underneath it, and full width because both are single-collection detail. */}
      <div className="w-full space-y-4">
        <SnapshotManager collectionName={decoded} basePath="/data/knowledge/indexes" />
        <PayloadIndexManager collectionName={decoded} />
      </div>
    </PageFrame>
  );
}
