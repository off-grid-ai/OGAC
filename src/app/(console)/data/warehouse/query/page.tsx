import { QueryPageContent } from '@/app/(console)/data/query/content';

export default function WarehouseQueryPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ sql?: string }> }>) {
  return <QueryPageContent embedded searchParams={searchParams} showHeading={false} />;
}
