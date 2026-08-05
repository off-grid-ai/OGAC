import { AnalyticsInsightsSource } from '@/app/(console)/insights/analytics/content';

export default function UsageOverviewPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ pipeline?: string }> }>) {
  return <AnalyticsInsightsSource destination="overview" searchParams={searchParams} />;
}
