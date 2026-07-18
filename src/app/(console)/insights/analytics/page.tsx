import { redirect } from 'next/navigation';
import { createElement } from 'react';
import { UsageInsightsView } from '@/components/insights/UsageInsightsView';
import { computeAnalytics } from '@/lib/analytics';
import {
  INSIGHTS_USAGE_DESTINATIONS,
  type InsightsUsageCostSearchParams,
  type InsightsUsageDestinationId,
  insightsUsageCostRouteWithSearchParams,
} from '@/lib/insights-usage-cost-routes';
import { requireModuleForUser } from '@/lib/module-access';
import { pipelineTag } from '@/lib/pipeline-api-key-format';
import { listPipelines } from '@/lib/pipelines';
import { resolvePipelineFacet } from '@/lib/pipelines-policy';
import { safeSupersetDashboard } from '@/lib/superset-data';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

type UsageSearchParams = InsightsUsageCostSearchParams & { pipeline?: string };

/**
 * The live analytics data source shared by the durable Usage leaves. The legacy route remains the
 * compatibility entry point below, while this named export keeps data access and tenancy in one
 * server-owned seam.
 */
export async function AnalyticsInsightsSource({
  destination,
  searchParams,
}: Readonly<{
  destination: InsightsUsageDestinationId;
  searchParams: Promise<UsageSearchParams>;
}>) {
  await requireModuleForUser('analytics');
  const params = await searchParams;
  const orgId = await currentOrgId();
  const pipelines = await listPipelines(orgId).catch(() => []);
  const facet = resolvePipelineFacet(
    params.pipeline,
    pipelines.map((pipeline) => pipeline.id),
  );
  const [analytics, supersetDashboard] = await Promise.all([
    computeAnalytics(facet ? pipelineTag(facet) : null),
    destination === 'dashboards' ? safeSupersetDashboard() : Promise.resolve(undefined),
  ]);
  const facetName = facet
    ? (pipelines.find((pipeline) => pipeline.id === facet)?.name ?? facet)
    : null;

  return createElement(UsageInsightsView, {
    destination,
    analytics,
    facetName,
    pipelines: pipelines.map((pipeline) => ({ id: pipeline.id, name: pipeline.name })),
    supersetDashboard,
  });
}

export default async function LegacyAnalyticsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<InsightsUsageCostSearchParams> }>) {
  const params = await searchParams;
  redirect(insightsUsageCostRouteWithSearchParams(INSIGHTS_USAGE_DESTINATIONS[0].route, params));
}
