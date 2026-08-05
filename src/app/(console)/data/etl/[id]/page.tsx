import { EtlJobDetailContent } from './content';

export const dynamic = 'force-dynamic';

export default function EtlJobDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  return <EtlJobDetailContent params={params} />;
}
