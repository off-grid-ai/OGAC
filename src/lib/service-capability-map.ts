/**
 * Honest service capability audit registry.
 *
 * This file owns the static, versioned result of the service-to-console audit. It deliberately
 * keeps upstream availability, adapter/API wiring, UI exposure, and production use as separate
 * gates. A control can exist in the UI while its adapter is missing, and an adapter can be wired
 * without a verified production workflow. Collapsing those states into one percentage would hide
 * the exact gap operators need to close.
 */

export const CAPABILITY_GATES = ['upstream', 'adapter', 'ui', 'workflow'] as const;

export type CapabilityGate = (typeof CAPABILITY_GATES)[number];
export type CapabilityGateStatus = 'yes' | 'partial' | 'no';

export const CAPABILITY_GATE_LABELS: Readonly<Record<CapabilityGate, string>> = {
  upstream: 'Available upstream',
  adapter: 'Adapter / API',
  ui: 'UI exposed',
  workflow: 'Production workflow',
};

export interface CapabilityGateAssessment {
  status: CapabilityGateStatus;
  evidence: string;
}

export interface ServiceCapabilityItem {
  id: string;
  name: string;
  summary: string;
  /** The closest real console place where an operator can use or inspect this capability. */
  uiHref: string;
  uiLabel: string;
  /** Concrete remaining work. Empty only when all four gates are verified. */
  gap: string;
  gates: Readonly<Record<CapabilityGate, CapabilityGateAssessment>>;
}

export interface ServiceCapabilityAudit {
  serviceId: string;
  serviceLabel: string;
  upstreamVersion: string;
  versionSource: string;
  auditedAt: string;
  summary: string;
  items: readonly ServiceCapabilityItem[];
}

export interface AuditedCapabilitySummary {
  status: 'audited';
  verifiedGates: number;
  partialGates: number;
  totalGates: number;
  productionItems: number;
  totalItems: number;
}

export interface NotAuditedCapabilitySummary {
  status: 'not-audited';
}

export type ServiceCapabilitySummary = AuditedCapabilitySummary | NotAuditedCapabilitySummary;

type GateInput = readonly [
  CapabilityGateStatus,
  string,
  CapabilityGateStatus,
  string,
  CapabilityGateStatus,
  string,
  CapabilityGateStatus,
  string,
];

function capability(
  id: string,
  name: string,
  summary: string,
  uiHref: string,
  uiLabel: string,
  gap: string,
  input: GateInput,
): ServiceCapabilityItem {
  return {
    id,
    name,
    summary,
    uiHref,
    uiLabel,
    gap,
    gates: {
      upstream: { status: input[0], evidence: input[1] },
      adapter: { status: input[2], evidence: input[3] },
      ui: { status: input[4], evidence: input[5] },
      workflow: { status: input[6], evidence: input[7] },
    },
  };
}

const DRIFT_ROUTE = '/insights/quality/drift';
const PRESIDIO_ROUTE = '/governance/guardrails/overview';
const REDPANDA_ROUTE = '/operations/services/streaming';
const OTEL_ROUTE = '/operations/services/otel-collector';
const ROUTER_ROUTE = '/runtime/models/routing';

const AUDITS: readonly ServiceCapabilityAudit[] = [
  {
    serviceId: 'evidently',
    serviceLabel: 'Evidently',
    upstreamVersion: '0.4.40',
    versionSource: 'deploy/sidecars/drift/requirements.txt',
    auditedAt: '2026-07-19',
    summary:
      'The live sidecar runs one DataDriftPreset over a single eval-score column. The broader catalog is visible, but most selections are not implemented by the sidecar contract.',
    items: [
      capability(
        'dataset-drift',
        'Dataset drift preset',
        'Compare baseline and current eval-score windows and return dataset drift plus drifted share.',
        DRIFT_ROUTE,
        'Open drift analysis',
        'Production use is conditional on the Evidently adapter and URL. Persist a service-attributed run record to verify when the sidecar, rather than the PSI fallback, produced the verdict.',
        [
          'yes',
          'DataDriftPreset is included in Evidently 0.4.40.',
          'yes',
          'The sidecar executes DataDriftPreset on the score column.',
          'yes',
          'The quality drift page runs and displays the normalized report.',
          'partial',
          'The quality workflow calls the adapter, but silently falls back to first-party PSI and stores no engine-attributed run evidence.',
        ],
      ),
      capability(
        'data-summary',
        'Data summary preset',
        'Compare descriptive statistics, missing values, and column shape across windows.',
        DRIFT_ROUTE,
        'Inspect the catalog entry',
        'The UI sends DataSummaryPreset, but the Python request model drops the preset field and still runs DataDriftPreset. Extend the sidecar contract and return preset-specific results.',
        [
          'yes',
          'DataSummaryPreset is available in the audited Evidently release.',
          'no',
          'The sidecar request model accepts only reference and current arrays.',
          'yes',
          'Data Summary is selectable in the drift catalog.',
          'no',
          'No business workflow receives a DataSummaryPreset result.',
        ],
      ),
      capability(
        'data-quality',
        'Data quality preset',
        'Check missing, duplicated, constant, and out-of-range column behavior.',
        DRIFT_ROUTE,
        'Inspect the catalog entry',
        'The UI selection is dropped by the sidecar. Add DataQualityPreset execution, a typed response, and workflow evidence before calling this integrated.',
        [
          'yes',
          'DataQualityPreset is available in the audited Evidently release.',
          'no',
          'The sidecar always constructs DataDriftPreset.',
          'yes',
          'Data Quality is selectable in the drift catalog.',
          'no',
          'No business workflow receives an Evidently data-quality result.',
        ],
      ),
      capability(
        'psi-method',
        'PSI method selection',
        'Run Population Stability Index as the selected per-column drift method.',
        DRIFT_ROUTE,
        'Open PSI selection',
        'The first-party fallback computes PSI, but the Evidently sidecar ignores the selected method. Implement the method field in the sidecar and attribute the result to the engine that ran it.',
        [
          'yes',
          'PSI is an Evidently stat-test option.',
          'partial',
          'The console computes PSI locally; the Evidently sidecar does not honor method=psi.',
          'yes',
          'PSI is selectable and its fallback is labelled.',
          'partial',
          'PSI is used in the quality workflow, but the verified path is first-party rather than Evidently.',
        ],
      ),
      capability(
        'stat-tests',
        'Statistical test selection',
        'Select KS, Wasserstein, KL, Jensen-Shannon, chi-square, Z, TVD, or Cramer-style tests.',
        DRIFT_ROUTE,
        'Browse statistical tests',
        'The catalog exposes these methods, but the sidecar ignores method and always lets DataDriftPreset choose. Implement and verify every advertised token, including the Cramer token mapping.',
        [
          'yes',
          'The audited release includes the named numerical and categorical tests.',
          'no',
          'No selected stat-test token reaches Evidently execution.',
          'yes',
          'The methods are searchable and selectable in the catalog.',
          'no',
          'No production result proves that an operator-selected stat test ran.',
        ],
      ),
      capability(
        'column-overrides',
        'Per-column method overrides',
        'Choose different drift tests for individual columns and tune dataset drift share.',
        DRIFT_ROUTE,
        'Open drift configuration',
        'The API accepts columnMethods and a drift-share threshold, but the sidecar drops both. Add a tabular dataset contract, apply per-column tests, and return per-column evidence.',
        [
          'yes',
          'Evidently supports per-column stat-test configuration.',
          'no',
          'The single score-array sidecar cannot apply column-specific configuration.',
          'yes',
          'The catalog can build and submit column override configuration.',
          'no',
          'No production workflow has multiple columns or verified override execution.',
        ],
      ),
      capability(
        'projects-history-monitoring',
        'Projects, report history, and monitoring',
        'Persist reports, compare runs over time, and operate Evidently monitoring projects.',
        DRIFT_ROUTE,
        'Open current drift view',
        'The integration is a stateless wrapper. Add a deliberate system of record or explicitly keep this capability out of scope; do not imply Evidently project history exists.',
        [
          'yes',
          'Evidently provides report and monitoring workflows.',
          'no',
          'The adapter sends one request and stores no Evidently project or report identifier.',
          'no',
          'The console shows current normalized drift only.',
          'no',
          'No workflow reads Evidently report history or monitoring state.',
        ],
      ),
    ],
  },
  {
    serviceId: 'presidio',
    serviceLabel: 'Presidio',
    upstreamVersion: '2.2.356',
    versionSource: 'deploy/docker-compose.yml',
    auditedAt: '2026-07-19',
    summary:
      'Text analysis, replacement anonymization, org recognizers, deny lists, and thresholds are integrated into the data-redaction path. Language and advanced anonymizer operations remain narrow.',
    items: [
      capability(
        'text-analysis',
        'Text entity analysis',
        'Detect built-in PII entities and return typed spans with confidence scores.',
        '/governance/guardrails/test',
        'Test live detection',
        '',
        [
          'yes',
          'The analyzer image exposes /analyze.',
          'yes',
          'scanWithPresidio posts a typed analyze request and applies returned spans.',
          'yes',
          'The Guardrails test surface runs the active engine.',
          'yes',
          'The selected data-redaction adapter runs in app and data-movement policy checks.',
        ],
      ),
      capability(
        'replace-anonymization',
        'Replacement anonymization',
        'Send analyzed spans to the anonymizer and replace values with entity markers.',
        '/governance/guardrails/test',
        'Test live redaction',
        '',
        [
          'yes',
          'The anonymizer image exposes /anonymize with replace operators.',
          'yes',
          'The adapter calls analyzer then anonymizer and has a span-safe local fallback.',
          'yes',
          'The test surface displays the redacted result and active engine.',
          'yes',
          'Data-redaction workflows consume the returned redacted text.',
        ],
      ),
      capability(
        'pattern-recognizers',
        'Custom pattern recognizers',
        'Create org-scoped regex and context recognizers and send them per analyze request.',
        '/governance/guardrails/recognizers',
        'Manage recognizers',
        '',
        [
          'yes',
          'Presidio accepts ad_hoc_recognizers with regex patterns and context.',
          'yes',
          'Stored recognizers are normalized and merged into every analyze request.',
          'yes',
          'The recognizers route provides create, update, enable, and delete controls.',
          'yes',
          'The same org policy is loaded by the real data-redaction adapter.',
        ],
      ),
      capability(
        'deny-lists',
        'Custom deny lists',
        'Flag fixed org-specific terms as a named PII entity.',
        '/governance/guardrails/recognizers',
        'Manage deny lists',
        '',
        [
          'yes',
          'PatternRecognizer supports deny_list values.',
          'yes',
          'Deny lists are translated into enabled ad hoc recognizers.',
          'yes',
          'The recognizer manager supports deny-list CRUD.',
          'yes',
          'Enabled deny lists are loaded into production analyze requests.',
        ],
      ),
      capability(
        'confidence-thresholds',
        'Global and per-entity thresholds',
        'Set an org floor and stricter or looser thresholds by entity type.',
        '/governance/guardrails/thresholds',
        'Manage thresholds',
        '',
        [
          'yes',
          'The analyzer accepts a request score threshold.',
          'yes',
          'The global floor is sent upstream and per-entity thresholds are enforced on returned scores.',
          'yes',
          'The thresholds route edits the org policy.',
          'yes',
          'The real adapter loads and applies the org threshold policy.',
        ],
      ),
      capability(
        'languages',
        'Language selection and multilingual analysis',
        'Choose a supported language and recognizer set for each analysis request.',
        PRESIDIO_ROUTE,
        'Inspect Presidio status',
        'The adapter has a language parameter but every production call defaults to en. Add supported-language discovery, validation, and an org or pipeline setting before advertising multilingual detection.',
        [
          'yes',
          'Presidio supports language-specific recognizers.',
          'partial',
          'The request builder accepts language, but the registered port never supplies a non-English value.',
          'no',
          'There is no language control on the Guardrails surface.',
          'no',
          'Production scans are fixed to English.',
        ],
      ),
      capability(
        'advanced-anonymizers',
        'Mask, hash, encrypt, redact, and custom operators',
        'Apply an anonymizer operator per entity instead of fixed replacement markers.',
        '/governance/guardrails/masking',
        'Open masking policy',
        'The adapter hard-codes replace. Add a validated operator policy, secret-backed encryption keys, reversible-data handling, and UI controls before exposing advanced operators.',
        [
          'yes',
          'Presidio anonymizer ships multiple operator types.',
          'partial',
          'The analyzer-to-anonymizer flow is wired, but only replace is constructed.',
          'no',
          'Masking rules do not configure Presidio anonymizer operators.',
          'no',
          'No production workflow selects a non-replace operator.',
        ],
      ),
      capability(
        'image-redaction',
        'Image PII redaction',
        'Detect and redact PII in images and scanned documents.',
        PRESIDIO_ROUTE,
        'Inspect Presidio status',
        'The deployed analyzer/anonymizer pair has no image-redactor adapter, API route, or review UI.',
        [
          'yes',
          'Presidio provides an image redactor capability.',
          'no',
          'No image-redactor service or adapter is registered.',
          'no',
          'No image redaction UI exists.',
          'no',
          'No document or media workflow invokes Presidio image redaction.',
        ],
      ),
    ],
  },
  {
    serviceId: 'streaming',
    serviceLabel: 'Redpanda',
    upstreamVersion: '24.2.7',
    versionSource: 'deploy/docker-compose.yml',
    auditedAt: '2026-07-19',
    summary:
      'The console has an honest admin, REST Proxy, and Schema Registry workbench. Registered Kafka sources are still catalog-only, so manual produce and consume controls are not a production data flow.',
    items: [
      capability(
        'cluster-health',
        'Cluster and broker health',
        'Inspect cluster health, broker membership, and boundary reachability.',
        REDPANDA_ROUTE,
        'Open streaming service',
        '',
        [
          'yes',
          'The Redpanda Admin API reports cluster and broker state.',
          'yes',
          'The adapter reads health_overview and brokers.',
          'yes',
          'The service detail displays live boundary and health state.',
          'yes',
          'Operations uses the probe to assess the deployed streaming service.',
        ],
      ),
      capability(
        'topic-inventory',
        'Topic and partition inventory',
        'List topics with partition, leader, and replica placement.',
        `${REDPANDA_ROUTE}?manage=topics`,
        'Inspect topics',
        '',
        [
          'yes',
          'The Admin API exposes partition metadata.',
          'yes',
          'Partition rows are normalized and grouped into topics.',
          'yes',
          'The Topics view lists partitions and brokers.',
          'yes',
          'Operators can inspect the real broker topology during service operations.',
        ],
      ),
      capability(
        'produce-records',
        'Produce JSON records',
        'Publish keyed or unkeyed JSON records through the REST Proxy.',
        `${REDPANDA_ROUTE}?manage=topics`,
        'Open producer workbench',
        'The control is an admin workbench only. Wire governed pipeline output to a registered stream and record delivery outcomes before calling this a business workflow.',
        [
          'yes',
          'The REST Proxy accepts topic records.',
          'yes',
          'The adapter validates topic and value and produces one JSON record.',
          'yes',
          'The Topics view provides a JSON producer.',
          'no',
          'No console pipeline or connector publishes through this adapter.',
        ],
      ),
      capability(
        'consume-records',
        'Consume JSON records',
        'Create a temporary consumer, subscribe, poll records, and close it.',
        `${REDPANDA_ROUTE}?manage=consumer`,
        'Open consumer workbench',
        'Kafka connectors are explicitly catalog-only. Implement offset-safe stream ingestion, retries, tenancy, and pipeline checkpoints before this reaches production data flows.',
        [
          'yes',
          'The REST Proxy exposes consumer lifecycle and polling.',
          'yes',
          'The adapter creates, subscribes, polls, and deletes a temporary consumer.',
          'yes',
          'The Consumer view exposes a temporary poll.',
          'no',
          'No registered source or pipeline consumes records through this adapter.',
        ],
      ),
      capability(
        'schema-registry',
        'Schema Registry lifecycle',
        'List subjects, register AVRO, JSON, or Protobuf versions, and delete subjects or versions.',
        `${REDPANDA_ROUTE}?manage=schemas`,
        'Manage schemas',
        'The API supports version delete, but the current UI deletes whole subjects only and always submits JSON. Add version history, compatibility checks, format selection, and governed flow binding.',
        [
          'yes',
          'Redpanda Schema Registry supports subject and version lifecycle.',
          'yes',
          'The adapter lists, creates, and deletes subjects and versions across three formats.',
          'partial',
          'The UI lists subjects and registers JSON, but has no version detail or version delete control.',
          'no',
          'No production stream validates records against a console-managed schema.',
        ],
      ),
      capability(
        'topic-lifecycle',
        'Topic create, configure, and delete',
        'Manage partition counts, replication, retention, and topic lifecycle.',
        `${REDPANDA_ROUTE}?manage=topics`,
        'Inspect topic inventory',
        'Only topic inventory exists. Add validated lifecycle APIs, destructive confirmation, audit events, and workload ownership checks.',
        [
          'yes',
          'Redpanda supports topic lifecycle and configuration.',
          'no',
          'The adapter has no topic mutation methods.',
          'no',
          'The Topics view is read-only apart from producing records.',
          'no',
          'No workflow provisions or retires topics.',
        ],
      ),
      capability(
        'consumer-groups-offsets',
        'Consumer groups and offsets',
        'Inspect lag, reset offsets, and manage durable consumer groups.',
        `${REDPANDA_ROUTE}?manage=consumer`,
        'Open consumer workbench',
        'The temporary poll is not group operations. Add lag read-back, offset reset safeguards, and ownership-scoped durable consumers.',
        [
          'yes',
          'Kafka-compatible consumer groups and offsets are available upstream.',
          'partial',
          'A temporary group is created for one poll, but group state is not inspected or managed.',
          'partial',
          'The UI accepts a group name but exposes no lag or offsets.',
          'no',
          'No durable business consumer uses this surface.',
        ],
      ),
      capability(
        'security-quotas',
        'ACLs, users, and quotas',
        'Manage Kafka principals, topic ACLs, and client quotas.',
        REDPANDA_ROUTE,
        'Open streaming service',
        'Add authenticated boundaries and a tenant-safe security management adapter before exposing ACL or quota controls.',
        [
          'yes',
          'Redpanda supports Kafka security and quota administration.',
          'no',
          'No security or quota endpoint is integrated.',
          'no',
          'No ACL, user, or quota UI exists.',
          'no',
          'No workflow provisions streaming permissions.',
        ],
      ),
      capability(
        'advanced-cluster-ops',
        'Partition movement, maintenance, and tiered storage',
        'Operate rebalancing, maintenance mode, partition reassignment, and remote storage.',
        REDPANDA_ROUTE,
        'Open streaming service',
        'These Redpanda admin capabilities are outside the current adapter. Keep them in the native service UI or add explicit guarded operations with runbook ownership.',
        [
          'yes',
          'The audited Redpanda release exposes advanced cluster operations.',
          'no',
          'The adapter reads cluster state only.',
          'no',
          'No advanced cluster operation is exposed.',
          'no',
          'No console workflow runs cluster maintenance.',
        ],
      ),
    ],
  },
  {
    serviceId: 'otel-collector',
    serviceLabel: 'OpenTelemetry Collector',
    upstreamVersion: '0.116.0',
    versionSource: 'deploy/docker-compose.yml',
    auditedAt: '2026-07-19',
    summary:
      'The console emits OTLP/HTTP traces and verifies that trace ingest accepts a real envelope. Collector pipelines are static deployment config, with trace and metric read-back in separate backends.',
    items: [
      capability(
        'otlp-traces',
        'OTLP trace ingest',
        'Receive OTLP/HTTP and OTLP/gRPC traces from console workloads.',
        OTEL_ROUTE,
        'Inspect collector readiness',
        'Code emits traces when a collector URL is configured, but the audit has no persisted collector-attributed delivery receipt for a real run. Add correlation through collector and Jaeger read-back.',
        [
          'yes',
          'The contrib collector ships OTLP HTTP and gRPC receivers.',
          'yes',
          'emitSpan posts OTLP/HTTP JSON and the readiness probe sends a valid empty trace envelope.',
          'yes',
          'Service detail reports real OTLP ingest acceptance.',
          'partial',
          'Business code emits spans, but collector-backed end-to-end delivery is not recorded per run.',
        ],
      ),
      capability(
        'trace-export-jaeger',
        'Trace export to Jaeger',
        'Batch accepted traces and forward them to the Jaeger OTLP endpoint.',
        '/operations/health/traces',
        'Open trace explorer',
        'The deploy config names Jaeger, but the console does not prove a given emitted span crossed the collector. Add a correlated integration check and delivery failure state.',
        [
          'yes',
          'The collector supports OTLP exporters.',
          'partial',
          'The exporter is configured in deploy/otel-collector.yaml, outside a runtime adapter.',
          'yes',
          'Platform Health reads Jaeger traces back.',
          'partial',
          'Trace read-back exists, but collector traversal is not attributed or verified per production run.',
        ],
      ),
      capability(
        'otlp-metrics',
        'OTLP metrics and remote write',
        'Receive OTLP metrics and export them to VictoriaMetrics by Prometheus remote write.',
        '/operations/health/metrics',
        'Open platform metrics',
        'The audit exporter can push metrics, but no always-on business workflow is proven to send them through this collector. Add scheduled export and correlate accepted/exported counts.',
        [
          'yes',
          'The collector supports OTLP metrics and Prometheus remote write.',
          'partial',
          'Static config wires the pipeline and the audit exporter can push OTLP metrics.',
          'yes',
          'Platform Health reads the destination metrics store.',
          'no',
          'No verified production workflow continuously emits the console metric set through the collector.',
        ],
      ),
      capability(
        'otlp-logs',
        'OTLP log ingest and export',
        'Receive structured logs and deliver them to an operational log backend.',
        '/operations/health/logs',
        'Open platform logs',
        'The collector log pipeline exports only to debug. Wire VictoriaLogs or OpenSearch, preserve tenant and correlation fields, and verify read-back before claiming log delivery.',
        [
          'yes',
          'The collector supports OTLP logs and many log exporters.',
          'partial',
          'The deploy config accepts logs but routes them only to the debug exporter.',
          'partial',
          'A logs UI exists, but it is not evidence of collector-fed logs.',
          'no',
          'No business log path is verified through the collector.',
        ],
      ),
      capability(
        'readiness',
        'Protocol-level ingest readiness',
        'Verify that the configured OTLP receiver accepts a valid export envelope.',
        OTEL_ROUTE,
        'Inspect collector readiness',
        '',
        [
          'yes',
          'OTLP receivers acknowledge valid export requests.',
          'yes',
          'probeOtelReadiness posts a valid empty resourceSpans request to /v1/traces.',
          'yes',
          'The Services directory and detail show accepted, down, or unconfigured state.',
          'yes',
          'Operations health uses the protocol probe rather than a misleading GET port check.',
        ],
      ),
      capability(
        'pipeline-configuration',
        'Receiver, processor, and exporter configuration',
        'Manage collector pipelines and route signals to approved destinations.',
        OTEL_ROUTE,
        'Inspect current collector service',
        'Configuration is a committed YAML deployment artifact. Keep it deployment-owned or add a validated config workflow with rollout, rollback, and secret handling; do not add a raw YAML editor.',
        [
          'yes',
          'Collector pipelines are composed from receivers, processors, and exporters.',
          'partial',
          'One static deployment config is present; there is no console adapter for lifecycle changes.',
          'no',
          'No pipeline configuration UI exists.',
          'no',
          'No production workflow changes collector config through the console.',
        ],
      ),
      capability(
        'processing-policies',
        'Sampling, filtering, redaction, and routing processors',
        'Apply telemetry policy before export, including tail sampling and sensitive-field removal.',
        OTEL_ROUTE,
        'Inspect current collector service',
        'Only the batch processor is configured. Add explicit telemetry-governance policy, validation, and end-to-end tests before introducing sampling or redaction processors.',
        [
          'yes',
          'The contrib collector includes sampling, filter, transform, and routing processors.',
          'partial',
          'The deployment uses batch only.',
          'no',
          'No processing policy is visible or editable.',
          'no',
          'No production workflow applies governed telemetry processing.',
        ],
      ),
      capability(
        'self-telemetry',
        'Collector throughput, errors, and queue telemetry',
        'Inspect accepted spans, exporter failures, batch size, and exporter queue depth.',
        '/operations/health/metrics',
        'Inspect collector metrics',
        'The metrics queries exist, but the deployment config does not prove collector self-metrics reach VictoriaMetrics. Wire and verify the collector telemetry reader or label the queries unavailable.',
        [
          'yes',
          'The collector emits internal metrics for receivers, processors, and exporters.',
          'partial',
          'The VictoriaMetrics adapter defines collector metric queries without a verified self-telemetry export path.',
          'yes',
          'Platform Health exposes the collector metric cards.',
          'no',
          'No verified production alert or operation consumes these collector metrics.',
        ],
      ),
    ],
  },
  {
    serviceId: 'litellm',
    serviceLabel: 'LiteLLM',
    upstreamVersion: 'main-stable (mutable image tag)',
    versionSource: 'deploy/docker-compose.yml',
    auditedAt: '2026-07-19',
    summary:
      'The router config generator, management read-back, and inference endpoint seam are built. The live model-door cutover and callback delivery remain unverified, so routing and enforcement do not count as production use.',
    items: [
      capability(
        'openai-proxy',
        'OpenAI-compatible inference proxy',
        'Serve chat and model requests through a single OpenAI-compatible model door.',
        ROUTER_ROUTE,
        'Inspect inference wiring',
        'The endpoint resolver can select LiteLLM, but the audited deployment has no verified live cutover. Run chat and governed pipeline traffic through the selected provider and record the serving deployment.',
        [
          'yes',
          'LiteLLM Proxy exposes OpenAI-compatible inference APIs.',
          'yes',
          'The gateway endpoint seam resolves LiteLLM URL and bearer credentials.',
          'yes',
          'The Routing view shows the selected inference door.',
          'partial',
          'Production request paths support the seam, but live LiteLLM cutover is not verified.',
        ],
      ),
      capability(
        'load-balance-failover',
        'Load balancing, retries, and failover',
        'Route a model alias across fleet and cloud deployments with health-aware retry policy.',
        ROUTER_ROUTE,
        'Inspect routing health',
        'Generated config enables routing policy, but no live multi-node failure drill proves failover on the production model door.',
        [
          'yes',
          'LiteLLM Router supports deployment groups, health-aware balancing, retries, and fallbacks.',
          'yes',
          'The generated config defines model groups, retry policy, and deployment metadata.',
          'yes',
          'The Routing view displays deployment health.',
          'no',
          'No verified production cutover or failure drill exists.',
        ],
      ),
      capability(
        'deployment-inventory',
        'Deployment inventory and health',
        'Read configured models and merge them with healthy and unhealthy endpoint state.',
        ROUTER_ROUTE,
        'Inspect deployments',
        '',
        [
          'yes',
          'LiteLLM exposes model info and health endpoints.',
          'yes',
          'safeRouterView merges /model/info and /health without fabricating missing deployments.',
          'yes',
          'The Routing view renders deployment, model, egress, vision, and health.',
          'yes',
          'Operations can inspect the configured LiteLLM service independently of model-door selection.',
        ],
      ),
      capability(
        'budgets-rate-limits',
        'Budgets and RPM/TPM limits',
        'Enforce spend and request limits on virtual keys.',
        ROUTER_ROUTE,
        'Inspect key budget',
        'The adapter reads only the caller or master key snapshot and the UI is read-only. Add tenant-safe key selection, CRUD, enforced-limit verification, and audit records.',
        [
          'yes',
          'LiteLLM supports per-key budget, RPM, and TPM controls.',
          'partial',
          'The adapter reads one /key/info snapshot but does not create or update limits.',
          'partial',
          'The Routing view displays the returned budget and limits but cannot manage them.',
          'no',
          'No production request is verified to stop at a LiteLLM budget or rate limit.',
        ],
      ),
      capability(
        'virtual-keys',
        'Virtual key lifecycle',
        'Create, rotate, revoke, scope, and inspect LiteLLM virtual keys.',
        ROUTER_ROUTE,
        'Inspect current key snapshot',
        'Only /key/info read-back exists. Add a credential-brokered lifecycle API and UI without exposing raw keys after creation.',
        [
          'yes',
          'LiteLLM exposes virtual key management APIs.',
          'partial',
          'The adapter can inspect one key but has no lifecycle operations.',
          'partial',
          'A budget snapshot is visible; key management is absent.',
          'no',
          'No business workflow provisions or revokes LiteLLM keys.',
        ],
      ),
      capability(
        'provider-pools',
        'Fleet and cloud provider pools',
        'Generate deployment entries for on-prem nodes and approved cloud providers.',
        '/runtime/models/providers',
        'Inspect model providers',
        'The generator consumes fleet and environment inputs, but the console does not own a validated LiteLLM config publish or reload transaction.',
        [
          'yes',
          'LiteLLM supports many providers behind model aliases.',
          'yes',
          'buildLiteLLMConfig maps fleet nodes and cloud providers to model_list entries.',
          'partial',
          'Provider status is visible, but it is not a LiteLLM pool editor.',
          'no',
          'No production workflow publishes and reloads generated config through the console.',
        ],
      ),
      capability(
        'structured-callbacks',
        'Structured request logging callbacks',
        'Send completion outcomes, deployment, tokens, caller, latency, and status into traffic records.',
        '/runtime/models/traffic',
        'Open model traffic',
        'The pure payload mapper exists, but the concrete callback receiver and OpenSearch writer are missing. The traffic UI is not proof that LiteLLM callbacks are flowing.',
        [
          'yes',
          'LiteLLM emits StandardLoggingPayload callbacks.',
          'partial',
          'litellmPayloadToTrafficRecord is implemented; no callback process invokes and persists it.',
          'partial',
          'Traffic and logs surfaces exist but do not identify a LiteLLM callback source.',
          'no',
          'No production LiteLLM callback reaches the traffic index.',
        ],
      ),
      capability(
        'spend-analytics',
        'Spend and cost analytics',
        'Attribute request cost by key, model, deployment, team, and time window.',
        '/insights/cost',
        'Open cost insights',
        'The budget snapshot reports one spend total, while callback cost is deliberately not mapped into TrafficRecord. Add a canonical cost event and reconcile it with existing accounting.',
        [
          'yes',
          'LiteLLM calculates spend and exposes cost data.',
          'partial',
          'One key spend value is read; request-level cost is not persisted.',
          'partial',
          'Cost insights exist, but they are not fed by LiteLLM cost records.',
          'no',
          'No production accounting workflow consumes LiteLLM-attributed cost.',
        ],
      ),
      capability(
        'response-cache',
        'Response caching',
        'Cache eligible model responses with explicit privacy, scope, and expiry policy.',
        ROUTER_ROUTE,
        'Inspect router capabilities',
        'No LiteLLM cache is configured or surfaced. Define tenant-safe cache keys, PII exclusions, retention, and purge controls before enabling it.',
        [
          'yes',
          'LiteLLM supports response cache backends.',
          'no',
          'The generated config has no cache section.',
          'no',
          'No LiteLLM cache state or controls exist.',
          'no',
          'No production request uses LiteLLM response caching.',
        ],
      ),
      capability(
        'proxy-guardrails',
        'Proxy guardrails and policy hooks',
        'Run supported guardrails in the proxy before or after model calls.',
        ROUTER_ROUTE,
        'Inspect router capabilities',
        'Governance remains in the Off Grid pipeline spine. That is a valid ownership choice, but LiteLLM guardrail capability is not integrated and must not be counted.',
        [
          'yes',
          'LiteLLM supports proxy guardrail integrations.',
          'no',
          'No LiteLLM guardrail is configured or adapted.',
          'no',
          'The Router view has no proxy guardrail controls.',
          'no',
          'Production governance runs in the Off Grid policy and guardrail spine instead.',
        ],
      ),
    ],
  },
];

export const SERVICE_CAPABILITY_AUDITS = AUDITS;

export function getServiceCapabilityAudit(serviceId: string): ServiceCapabilityAudit | null {
  return AUDITS.find((audit) => audit.serviceId === serviceId) ?? null;
}

export function summarizeServiceCapabilityAudit(serviceId: string): ServiceCapabilitySummary {
  const audit = getServiceCapabilityAudit(serviceId);
  if (!audit) return { status: 'not-audited' };

  const assessments = audit.items.flatMap((item) =>
    CAPABILITY_GATES.map((gate) => item.gates[gate]),
  );
  return {
    status: 'audited',
    verifiedGates: assessments.filter((assessment) => assessment.status === 'yes').length,
    partialGates: assessments.filter((assessment) => assessment.status === 'partial').length,
    totalGates: assessments.length,
    productionItems: audit.items.filter((item) => item.gates.workflow.status === 'yes').length,
    totalItems: audit.items.length,
  };
}

export function capabilityCoveragePercent(summary: AuditedCapabilitySummary): number {
  if (summary.totalGates === 0) return 0;
  return Math.round((summary.verifiedGates / summary.totalGates) * 100);
}
