import { QueryPageContent } from './content';

export const dynamic = 'force-dynamic';

export default function QueryPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ sql?: string }> }>) {
  return <QueryPageContent searchParams={searchParams} />;
}
