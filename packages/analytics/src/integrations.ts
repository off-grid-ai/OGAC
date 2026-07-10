// @offgrid/analytics — integrations
//
// Static catalog of available analytics integrations. Consumers (e.g. the
// console settings UI) render config forms from `configFields` and wire the
// matching adapter sink from ./sinks.

export interface AnalyticsIntegration {
  id: string;
  name: string;
  category: 'analytics';
  /** Config field names the integration needs, if any. */
  configFields?: string[];
}

export const ANALYTICS_INTEGRATIONS: readonly AnalyticsIntegration[] = [
  { id: 'posthog', name: 'PostHog', category: 'analytics', configFields: ['apiKey', 'host'] },
  { id: 'mixpanel', name: 'Mixpanel', category: 'analytics', configFields: ['token'] },
  { id: 'webhook', name: 'Webhook', category: 'analytics', configFields: ['url'] },
  { id: 'builtin', name: 'Built-in analytics store', category: 'analytics' },
] as const;
