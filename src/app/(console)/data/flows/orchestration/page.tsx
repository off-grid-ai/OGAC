import { EtlJobsContent } from '@/app/(console)/data/etl/page';

export default function OrchestrationPage() {
  return <EtlJobsContent detailBasePath="/data/flows/orchestration" embedded showHeading={false} />;
}
