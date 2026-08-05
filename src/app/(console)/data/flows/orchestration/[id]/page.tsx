import { EtlJobDetailContent } from '@/app/(console)/data/etl/[id]/content';

export default function OrchestrationJobPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  return <EtlJobDetailContent params={params} backHref="/data/flows/orchestration" />;
}
