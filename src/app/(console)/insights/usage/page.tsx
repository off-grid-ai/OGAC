import { redirect } from 'next/navigation';
import {
  INSIGHTS_USAGE_DESTINATIONS,
  type InsightsUsageCostSearchParams,
  insightsUsageCostRouteWithSearchParams,
} from '@/lib/insights-usage-cost-routes';

export default async function UsagePage({
  searchParams,
}: Readonly<{ searchParams: Promise<InsightsUsageCostSearchParams> }>) {
  const params = await searchParams;
  redirect(insightsUsageCostRouteWithSearchParams(INSIGHTS_USAGE_DESTINATIONS[0].route, params));
}
