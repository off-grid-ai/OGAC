// PURE exporter registry + the finops→metric-sample builder. Zero I/O — maps a kind to its concrete
// exporter and shapes the spine's cost/usage rollup into Prometheus/OTLP metric samples.

import type { FinOps } from '@/lib/finops';
import type { Exporter, ExporterKind } from './types';
import { splunkHecExporter } from './splunk-hec';
import { openLineageExporter } from './openlineage';
import { prometheusExporter, type MetricSample } from './prometheus';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTRY: Record<ExporterKind, Exporter<any>> = {
  audit: splunkHecExporter,
  lineage: openLineageExporter,
  metrics: prometheusExporter,
};

// The concrete exporter for a kind. Pure lookup.
export function exporterFor(kind: ExporterKind): Exporter {
  return REGISTRY[kind];
}

// Shape the finops rollup into exportable metric samples (Prometheus/OTLP). Pure — the same samples
// feed both the /metrics scrape body and an OTLP push. Cost is a gauge (a point-in-time window
// total); request/token totals are counters. Per-model cost is labelled by model. This mirrors the
// numbers the FinOps surface shows, so a Grafana dashboard matches the console.
export function finOpsToSamples(f: FinOps): MetricSample[] {
  const samples: MetricSample[] = [
    {
      name: 'offgrid_requests_total',
      help: 'Total governed gateway requests in the current window.',
      type: 'counter',
      value: f.totals.requests,
    },
    {
      name: 'offgrid_tokens_total',
      help: 'Total tokens processed in the current window.',
      type: 'counter',
      value: f.totals.tokens,
    },
    {
      name: 'offgrid_cost_usd',
      help: 'Total spend (USD) in the current window.',
      type: 'gauge',
      value: f.totals.costUsd,
    },
    {
      name: 'offgrid_local_share_percent',
      help: 'Percent of requests served by local (on-device, $0) models.',
      type: 'gauge',
      value: f.totals.localShare,
    },
  ];
  for (const m of f.byModel) {
    samples.push({
      name: 'offgrid_model_cost_usd',
      help: 'Spend (USD) by model in the current window.',
      type: 'gauge',
      value: m.costUsd,
      labels: { model: m.label },
    });
    samples.push({
      name: 'offgrid_model_requests_total',
      help: 'Requests by model in the current window.',
      type: 'counter',
      value: m.requests,
      labels: { model: m.label },
    });
  }
  return samples;
}

export type { MetricSample };
