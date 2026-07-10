// @offgrid/analytics — public entry
//
// Plug-and-play usage analytics for the Off Grid AI local gateway. Register the
// built-in `analyticsSink(store)` (and/or an adapter sink) with the gateway's
// observability fan-out, then query the store for totals/rollups/timeseries.

export type { TrafficRecord, ObservabilitySink } from './gateway-types.js';

export {
  AnalyticsStore,
  type Totals,
  type GroupRow,
  type TimeBucket,
  type PromptCount,
} from './store.js';

export {
  analyticsSink,
  posthogSink,
  mixpanelSink,
  webhookSink,
} from './sinks.js';

export {
  ANALYTICS_INTEGRATIONS,
  type AnalyticsIntegration,
} from './integrations.js';
