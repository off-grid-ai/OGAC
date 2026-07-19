export const INSIGHTS_USAGE_DESTINATIONS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Request, token, latency, egress, outcome, and alert posture at a glance.',
    route: '/insights/usage/overview',
  },
  {
    id: 'traffic',
    label: 'Traffic',
    description: 'Inspect request volume and the live 24-hour gateway traffic stream.',
    route: '/insights/usage/traffic',
  },
  {
    id: 'latency',
    label: 'Latency',
    description: 'Track response-time trends and current performance degradation.',
    route: '/insights/usage/latency',
  },
  {
    id: 'adoption',
    label: 'Adoption',
    description: 'See which models receive traffic and how requests resolve.',
    route: '/insights/usage/adoption',
  },
  {
    id: 'dashboards',
    label: 'Dashboards',
    description: 'Read governed BI charts and open Superset for chart authoring.',
    route: '/insights/usage/dashboards',
  },
] as const;

export const INSIGHTS_COST_DESTINATIONS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Spend, tokens, users, and projects for the selected usage window.',
    route: '/insights/cost/overview',
  },
  {
    id: 'users',
    label: 'Users',
    description: 'Attribute requests, tokens, and spend to individual callers.',
    route: '/insights/cost/users',
  },
  {
    id: 'projects',
    label: 'Projects',
    description: 'Attribute requests, tokens, and spend to projects.',
    route: '/insights/cost/projects',
  },
  {
    id: 'models',
    label: 'Models',
    description: 'Compare prompt, completion, total tokens, and spend by model.',
    route: '/insights/cost/models',
  },
] as const;

export type InsightsUsageDestination = (typeof INSIGHTS_USAGE_DESTINATIONS)[number];
export type InsightsUsageDestinationId = InsightsUsageDestination['id'];
export type InsightsCostDestination = (typeof INSIGHTS_COST_DESTINATIONS)[number];
export type InsightsCostDestinationId = InsightsCostDestination['id'];

export type InsightsUsageCostSearchParams = InsightsSearchParams;

export function insightsUsageDestination(
  rawId: string | null | undefined,
): InsightsUsageDestination | undefined {
  return INSIGHTS_USAGE_DESTINATIONS.find((candidate) => candidate.id === rawId);
}

export function insightsCostDestination(
  rawId: string | null | undefined,
): InsightsCostDestination | undefined {
  return INSIGHTS_COST_DESTINATIONS.find((candidate) => candidate.id === rawId);
}

/**
 * Keep date/range, pipeline, status, and any future URL-owned filters intact when a base or legacy
 * route hands the operator to a durable leaf. Navigation changes the place, never the filter state.
 */
export const insightsUsageCostRouteWithSearchParams = insightsRouteWithSearchParams;
import { insightsRouteWithSearchParams, type InsightsSearchParams } from '@/lib/insights-routes';
