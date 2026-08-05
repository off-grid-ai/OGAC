import { AnalyticsInsightsSource } from '@/app/(console)/insights/analytics/content';

export default function UsageAdoptionPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ pipeline?: string }> }>) {
  return <AnalyticsInsightsSource destination="adoption" searchParams={searchParams} />;
}
