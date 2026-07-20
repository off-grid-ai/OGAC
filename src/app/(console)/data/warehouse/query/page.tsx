import { QueryPageContent } from '@/app/(console)/data/query/page';

export default function WarehouseQueryPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ sql?: string }> }>) {
  return <QueryPageContent embedded searchParams={searchParams} showHeading={false} />;
}
