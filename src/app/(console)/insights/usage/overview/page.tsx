import { AnalyticsInsightsSource } from '@/app/(console)/insights/analytics/page';

export default function UsageOverviewPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ pipeline?: string }> }>) {
  return <AnalyticsInsightsSource destination="overview" searchParams={searchParams} />;
}
