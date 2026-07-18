import { redirect } from 'next/navigation';
import {
  INSIGHTS_QUALITY_DESTINATIONS,
  insightsRouteWithSearchParams,
  type InsightsSearchParams,
} from '@/lib/insights-routes';

export default async function InsightsQualityPage({
  searchParams,
}: Readonly<{ searchParams: Promise<InsightsSearchParams> }>) {
  redirect(
    insightsRouteWithSearchParams(INSIGHTS_QUALITY_DESTINATIONS[0].route, await searchParams),
  );
}
