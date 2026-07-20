import { AnalyticsInsightsSource } from '@/app/(console)/insights/analytics/page';

export default function UsageLatencyPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ pipeline?: string }> }>) {
  return <AnalyticsInsightsSource destination="latency" searchParams={searchParams} />;
}
