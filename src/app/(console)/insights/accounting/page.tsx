import { redirect } from 'next/navigation';
import {
  INSIGHTS_COST_DESTINATIONS,
  type InsightsUsageCostSearchParams,
  insightsUsageCostRouteWithSearchParams,
} from '@/lib/insights-usage-cost-routes';

export const dynamic = 'force-dynamic';

export default async function LegacyAccountingPage({
  searchParams,
}: Readonly<{ searchParams: Promise<InsightsUsageCostSearchParams> }>) {
  const params = await searchParams;
  redirect(insightsUsageCostRouteWithSearchParams(INSIGHTS_COST_DESTINATIONS[0].route, params));
}
