import { notFound } from 'next/navigation';
import { PageFrame } from '@/components/PageFrame';
import { SnapshotManager } from '@/components/retrieval/SnapshotManager';
import { requireModuleForUser } from '@/lib/module-access';
import { validateCollectionName } from '@/lib/qdrant-snapshots';

export const dynamic = 'force-dynamic';

// Collection detail: live health + full snapshot (backup/DR) management for one vector collection.
export default async function CollectionDetailPage({
  params,
}: Readonly<{ params: Promise<{ name: string }> }>) {
  await requireModuleForUser('retrieval');
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  if (!validateCollectionName(decoded).ok) notFound();
  return (
    <PageFrame>
      <SnapshotManager collectionName={decoded} basePath="/data/knowledge/indexes" />
    </PageFrame>
  );
}
