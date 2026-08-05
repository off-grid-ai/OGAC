import { AnalyticsInsightsSource } from '@/app/(console)/insights/analytics/content';

export default function UsageTrafficPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ pipeline?: string }> }>) {
  return <AnalyticsInsightsSource destination="traffic" searchParams={searchParams} />;
}
