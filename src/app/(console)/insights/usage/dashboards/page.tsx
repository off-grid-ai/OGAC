import { AnalyticsInsightsSource } from '@/app/(console)/insights/analytics/page';

export default function UsageDashboardsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ pipeline?: string }> }>) {
  return <AnalyticsInsightsSource destination="dashboards" searchParams={searchParams} />;
}
