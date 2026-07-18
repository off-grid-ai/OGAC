export const INSIGHTS_AI_DESTINATIONS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'AI activity, scoring posture, and trace-store coverage at a glance.',
    route: '/insights/ai/overview',
  },
  {
    id: 'traces',
    label: 'Traces',
    description: 'Inspect trace waterfalls and governed agent runs.',
    route: '/insights/ai/traces',
  },
  {
    id: 'prompt-registry',
    label: 'Prompt registry',
    description: 'Read back prompts, datasets, and sessions from the tracing store.',
    route: '/insights/ai/prompt-registry',
  },
  {
    id: 'copilot',
    label: 'Copilot',
    description: 'Ask operational questions against your platform records and cited evidence.',
    route: '/insights/ai/copilot',
  },
] as const;

export const INSIGHTS_QUALITY_DESTINATIONS = [
  {
    id: 'scorecards',
    label: 'Scorecards',
    description: 'Track evaluation scores and pass rates without duplicating execution ownership.',
    route: '/insights/quality/scorecards',
  },
  {
    id: 'drift',
    label: 'Drift',
    description: 'Compare recent behavior with the active baseline and run drift checks.',
    route: '/insights/quality/drift',
  },
  {
    id: 'thresholds',
    label: 'Thresholds',
    description: 'Manage quality alert rules and the active drift baseline.',
    route: '/insights/quality/thresholds',
  },
] as const;

export type InsightsAiDestination = (typeof INSIGHTS_AI_DESTINATIONS)[number];
export type InsightsAiDestinationId = InsightsAiDestination['id'];
export type InsightsQualityDestination = (typeof INSIGHTS_QUALITY_DESTINATIONS)[number];
export type InsightsQualityDestinationId = InsightsQualityDestination['id'];

export function insightsAiDestination(
  rawId: string | null | undefined,
): InsightsAiDestination | undefined {
  return INSIGHTS_AI_DESTINATIONS.find((candidate) => candidate.id === rawId);
}

export function insightsQualityDestination(
  rawId: string | null | undefined,
): InsightsQualityDestination | undefined {
  return INSIGHTS_QUALITY_DESTINATIONS.find((candidate) => candidate.id === rawId);
}

export function isInsightsQualityEntityDetailPath(pathname: string): boolean {
  return /^\/insights\/quality\/evals\/[^/]+\/?$/.test(pathname.split(/[?#]/, 1)[0] ?? '');
}
