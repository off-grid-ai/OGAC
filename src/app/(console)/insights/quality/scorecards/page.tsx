import { redirect } from 'next/navigation';
import { insightsRouteWithSearchParams, type InsightsSearchParams } from '@/lib/insights-routes';

export default async function LegacyQualityScorecardsPage({ searchParams }: Readonly<{ searchParams: Promise<InsightsSearchParams> }>) {
  redirect(insightsRouteWithSearchParams('/solutions/quality/performance', await searchParams));
}
