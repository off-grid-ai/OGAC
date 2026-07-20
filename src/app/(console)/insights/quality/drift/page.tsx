import { redirect } from 'next/navigation';
import { insightsRouteWithSearchParams, type InsightsSearchParams } from '@/lib/insights-routes';

export default async function LegacyQualityDriftPage({ searchParams }: Readonly<{ searchParams: Promise<InsightsSearchParams> }>) {
  redirect(insightsRouteWithSearchParams('/solutions/quality/drift', await searchParams));
}
