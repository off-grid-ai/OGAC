import { redirect } from 'next/navigation';
import { legacyInsightsAiRoute, type InsightsSearchParams } from '@/lib/insights-routes';

export default async function InsightsAiPage({
  searchParams,
}: Readonly<{ searchParams: Promise<InsightsSearchParams> }>) {
  redirect(legacyInsightsAiRoute(await searchParams));
}
