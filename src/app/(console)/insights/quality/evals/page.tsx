import { redirect } from 'next/navigation';
import { insightsRouteWithSearchParams, type InsightsSearchParams } from '@/lib/insights-routes';

export default async function LegacyInsightsEvalListPage({
  searchParams,
}: Readonly<{ searchParams: Promise<InsightsSearchParams> }>) {
  redirect(insightsRouteWithSearchParams('/solutions/quality/runs', await searchParams));
}
