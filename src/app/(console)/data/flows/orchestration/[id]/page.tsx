import { EtlJobDetailContent } from '@/app/(console)/data/etl/[id]/page';

export default function OrchestrationJobPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  return <EtlJobDetailContent params={params} backHref="/data/flows/orchestration" />;
}
