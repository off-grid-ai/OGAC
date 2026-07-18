import { redirect } from 'next/navigation';
import { createElement } from 'react';
import { CostInsightsView } from '@/components/insights/CostInsightsView';
import { computeAccounting } from '@/lib/accounting';
import { isRangePreset, type RangePreset } from '@/lib/accounting-aggs';
import {
  INSIGHTS_COST_DESTINATIONS,
  type InsightsCostDestinationId,
  type InsightsUsageCostSearchParams,
  insightsUsageCostRouteWithSearchParams,
} from '@/lib/insights-usage-cost-routes';
import { requireModuleForUser } from '@/lib/module-access';
import { pipelineTag } from '@/lib/pipeline-api-key-format';
import { listPipelines } from '@/lib/pipelines';
import { resolvePipelineFacet } from '@/lib/pipelines-policy';
import { currentOrgId } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

type CostSearchParams = InsightsUsageCostSearchParams & {
  range?: string;
  pipeline?: string;
};

/**
 * The live accounting data source shared by the durable Cost leaves. Range and pipeline remain URL
 * filters, while attribution and tenant scoping stay in the existing accounting adapter.
 */
export async function AccountingInsightsSource({
  destination,
  searchParams,
}: Readonly<{
  destination: InsightsCostDestinationId;
  searchParams: Promise<CostSearchParams>;
}>) {
  await requireModuleForUser('accounting');
  const params = await searchParams;
  const range: RangePreset = params.range && isRangePreset(params.range) ? params.range : 'all';
  const orgId = await currentOrgId();
  const pipelines = await listPipelines(orgId).catch(() => []);
  const facet = resolvePipelineFacet(
    params.pipeline,
    pipelines.map((pipeline) => pipeline.id),
  );
  const accounting = await computeAccounting(range, facet ? pipelineTag(facet) : null);
  const facetName = facet
    ? (pipelines.find((pipeline) => pipeline.id === facet)?.name ?? facet)
    : null;
  const route =
    INSIGHTS_COST_DESTINATIONS.find((candidate) => candidate.id === destination)?.route ??
    INSIGHTS_COST_DESTINATIONS[0].route;

  return createElement(CostInsightsView, {
    accounting,
    destination,
    facetName,
    pipelines: pipelines.map((pipeline) => ({ id: pipeline.id, name: pipeline.name })),
    range,
    route,
    searchParams: params,
  });
}

export default async function LegacyAccountingPage({
  searchParams,
}: Readonly<{ searchParams: Promise<InsightsUsageCostSearchParams> }>) {
  const params = await searchParams;
  redirect(insightsUsageCostRouteWithSearchParams(INSIGHTS_COST_DESTINATIONS[0].route, params));
}
