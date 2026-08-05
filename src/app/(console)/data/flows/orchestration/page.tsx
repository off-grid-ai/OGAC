import { EtlJobsContent } from '@/app/(console)/data/etl/content';

export default function OrchestrationPage() {
  return <EtlJobsContent detailBasePath="/data/flows/orchestration" embedded showHeading={false} />;
}
