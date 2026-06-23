import { emitSpan } from '@/lib/otel';
import type { ObservabilityPort } from './types';

// Observability adapters speak one wire format (OTLP). Any backend — SigNoz, VictoriaMetrics,
// Langfuse — ingests it, so the console never hard-codes a vendor. The OTel emitter is the
// default seam; these dashboards are rich, so they render as SSO'd embeds rather than rebuilds.
export const otelObservability: ObservabilityPort = {
  meta: {
    id: 'otel',
    capability: 'observability',
    vendor: 'OpenTelemetry',
    license: 'Apache-2.0',
    render: 'headless',
    description: 'OTLP emission seam; any OTLP-compatible backend ingests it.',
  },
  emitSpan,
};

export const signozObservability: ObservabilityPort = {
  meta: {
    id: 'signoz',
    capability: 'observability',
    vendor: 'SigNoz',
    license: 'MIT',
    render: 'embed',
    embedUrl: process.env.OFFGRID_SIGNOZ_URL,
    description: 'Traces/metrics/logs dashboards. Surfaced as an SSO embed.',
  },
  emitSpan,
};
