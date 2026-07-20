import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICE_CAPABILITY_AUDITS } from '../src/lib/service-capability-map.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs', 'SERVICE_CAPABILITY_PROOF_WORKFLOWS.csv');

const programs = {
  1: {
    capability:
      'Governed, durable multi-step execution with human approval, restart recovery and signed output',
    primary: 'Temporal',
    supporting: 'OPA, OpenBao, Marquez, Off Grid App Worker',
    workflow:
      'FNOL claim → evidence → recommendation → claims-officer approval → signed disposition',
    value: 'Safely process thousands of cases with the same workforce',
  },
  2: {
    capability:
      'Grounded reasoning across existing enterprise data, with citations and policy-constrained recommendations',
    primary: 'Qdrant',
    supporting: 'LiteLLM, Presidio, LLM Guard',
    workflow:
      'CRM + Core Banking + product rules → compliant cross-sell recommendation',
    value:
      'Direct top-line growth without hallucinated or non-compliant recommendations',
  },
  3: {
    capability: 'Governed action/write-back into existing systems—not merely advice',
    primary: 'Off Grid connector/action runtime; Kestra for broader orchestration',
    supporting: 'Temporal, OPA, enterprise APIs',
    workflow:
      'Delinquency recommendation → approval → CRM task/write-back → outcome tracking',
    value:
      'Converts AI into completed work; improves cure rate and collector capacity',
  },
  4: {
    capability: 'Real-time event-to-decision-to-action processing',
    primary: 'Redpanda',
    supporting: 'Schema Registry, Temporal, Kestra',
    workflow:
      'Delinquency/claim event → prioritization → governed action within seconds',
    value:
      'Intervene before delinquency rolls forward; detect claim/fraud risk immediately',
  },
  5: {
    capability: 'Continuous AI QA and production release gating',
    primary: 'Ragas + Evidently',
    supporting: 'Langfuse, Great Expectations, OpenTelemetry',
    workflow:
      'Golden cases → faithfulness/relevance → drift/performance checks → block or approve release',
    value: 'Makes enterprise AI reliable, measurable and governable over time',
  },
  6: {
    capability: 'Governed enterprise data ingestion, storage, transformation and lifecycle',
    primary: 'Airbyte + ClickHouse',
    supporting: 'PostgreSQL, SeaweedFS, LanceDB, Marquez, enterprise source adapters',
    workflow:
      'Existing source → governed discovery → incremental replication → validated analytical model → lineage',
    value: 'Uses existing enterprise data without rip-and-replace or fragile manual pipelines',
  },
  7: {
    capability: 'Enterprise identity, secrets, policy and perimeter enforcement',
    primary: 'Keycloak + OpenBao + OPA',
    supporting: 'Network Gateway, Presidio, LLM Guard, Off Grid Console',
    workflow:
      'Enterprise identity → least-privilege access → secret lease → policy decision → audited request',
    value: 'Makes AI secure, compliant, governable and auditable by default',
  },
  8: {
    capability: 'Governed model routing, rollout, caching and cost control',
    primary: 'LiteLLM',
    supporting: 'Off Grid AI Gateway, Redis, Unleash, fleet inference nodes',
    workflow:
      'Governed request → eligible model pool → health-aware routing → budget enforcement → measured response',
    value: 'Improves reliability and cost while retaining control over where inference runs',
  },
  9: {
    capability: 'End-to-end observability, audit search and incident response',
    primary: 'OpenTelemetry + OpenSearch',
    supporting: 'Jaeger, VictoriaMetrics, VictoriaLogs, Langfuse, Marquez',
    workflow:
      'Production run → correlated traces/logs/metrics/lineage → anomaly → root cause → operator action',
    value: 'Cuts diagnosis time and makes every AI decision operationally accountable',
  },
  10: {
    capability: 'Platform resilience, backup, recovery and fleet operations',
    primary: 'Off Grid operations runtime',
    supporting: 'PostgreSQL, Qdrant, SeaweedFS, Temporal, OpenBao, FleetDM',
    workflow:
      'Failure or upgrade → safe drain/snapshot → supervised restart → restore → integrity verification',
    value: 'Keeps critical AI workflows available and recoverable on customer-owned infrastructure',
  },
  11: {
    capability: 'Governed analytics, dashboards and ROI evidence',
    primary: 'Apache Superset',
    supporting: 'ClickHouse, PostgreSQL, Langfuse, Off Grid outcomes ledger',
    workflow:
      'Operational events → governed metrics → role-specific dashboard → baseline/actual ROI review',
    value: 'Makes efficiency, effectiveness, top-line impact and justified ROI visible',
  },
  12: {
    capability: 'Complete operator administration and controlled platform change',
    primary: 'Off Grid Console',
    supporting: 'FleetDM, Unleash, Redis, service management adapters',
    workflow:
      'Operator intent → validated CRUD/action → controlled rollout → health verification → audit evidence',
    value: 'Makes the full AI platform consumable by technical and non-technical operators',
  },
};

const serviceProgram = {
  postgres: 6,
  qdrant: 2,
  marquez: 9,
  lancedb: 2,
  seaweedfs: 6,
  warehouse: 6,
  airbyte: 6,
  streaming: 4,
  'data-quality': 5,
  kestra: 3,
  opensearch: 9,
  langfuse: 5,
  evidently: 5,
  ragas: 5,
  victoriametrics: 9,
  victorialogs: 9,
  'otel-collector': 9,
  jaeger: 9,
  'enterprise-source-corebank': 2,
  'enterprise-source-policyadmin': 2,
  'enterprise-source-erp': 6,
  'enterprise-source-kafka': 4,
  'enterprise-source-minio': 6,
  'enterprise-source-crm': 2,
  console: 12,
  'edge-gateway': 7,
  gateway: 8,
  'llm-guard': 2,
  keycloak: 7,
  temporal: 1,
  'app-worker': 1,
  opa: 7,
  openbao: 7,
  unleash: 8,
  redis: 8,
  superset: 11,
  fleetdm: 10,
  presidio: 2,
  litellm: 8,
};

const overrides = new Map([
  ['postgres:backup-restore', 10],
  ['postgres:extensions-vector', 2],
  ['postgres:roles-replication-maintenance', 10],
  ['qdrant:snapshots-cluster', 10],
  ['marquez:openlineage-events', 1],
  ['marquez:run-history-facets', 1],
  ['lancedb:record-maintenance', 6],
  ['lancedb:versioning-index-tuning', 10],
  ['seaweedfs:buckets-credentials', 7],
  ['seaweedfs:lifecycle-versioning', 10],
  ['seaweedfs:topology-repair', 10],
  ['warehouse:cluster-operations', 10],
  ['kestra:triggers-schedules', 4],
  ['opensearch:security-alerting', 7],
  ['opensearch:cluster-snapshots-security', 10],
  ['otel-collector:processing-policies', 7],
  ['enterprise-source-corebank:connector-lifecycle', 6],
  ['enterprise-source-corebank:schema-cdc-admin', 6],
  ['enterprise-source-policyadmin:connector-lifecycle', 6],
  ['enterprise-source-policyadmin:schema-cdc-admin', 6],
  ['enterprise-source-crm:connector-lifecycle', 6],
  ['enterprise-source-crm:write-sync-webhooks', 3],
  ['enterprise-source-minio:versioning-retention-events', 10],
  ['console:authenticated-control-plane', 7],
  ['console:tenant-management', 12],
  ['console:self-lifecycle', 10],
  ['edge-gateway:supervised-recovery', 10],
  ['gateway:request-governance', 2],
  ['llm-guard:availability-failure-policy', 10],
  ['llm-guard:telemetry', 9],
  ['opa:policy-decisions', 1],
  ['openbao:vault-recovery', 10],
  ['redis:failure-fallback', 10],
  ['fleetdm:queries-policies', 7],
  ['presidio:image-redaction', 7],
  ['litellm:proxy-guardrails', 2],
  ['litellm:structured-callbacks', 9],
  ['litellm:spend-analytics', 11],
]);

const primaryLabels = {
  console: 'Off Grid Console',
  gateway: 'Off Grid AI Gateway',
  'app-worker': 'Off Grid App Worker',
  'enterprise-source-corebank': 'Existing Core Banking system',
  'enterprise-source-policyadmin': 'Existing Policy Administration system',
  'enterprise-source-erp': 'Existing Finance ERP',
  'enterprise-source-kafka': 'Existing Kafka-compatible event source',
  'enterprise-source-minio': 'Existing S3-compatible data lake',
  'enterprise-source-crm': 'Existing CRM',
};

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
}

const grouped = new Map(Object.keys(programs).map((key) => [Number(key), []]));
for (const service of SERVICE_CAPABILITY_AUDITS) {
  for (const item of service.items) {
    const key = `${service.serviceId}:${item.id}`;
    const program = overrides.get(key) ?? serviceProgram[service.serviceId];
    if (!programs[program]) throw new Error(`No proof program for ${key}`);
    grouped.get(program).push({ service, item, key });
  }
}

const header = [
  'Priority',
  'Capability to prove',
  'Primary OSS service',
  'Supporting services',
  'Best proof workflow',
  'Value unlocked',
];
const rows = [header];
for (const programNumber of Object.keys(programs).map(Number).sort((a, b) => a - b)) {
  const program = programs[programNumber];
  rows.push([
    String(programNumber),
    program.capability,
    program.primary,
    program.supporting,
    program.workflow,
    program.value,
  ]);
  const capabilities = grouped
    .get(programNumber)
    .sort((a, b) => a.key.localeCompare(b.key));
  capabilities.forEach(({ service, item, key }, index) => {
    rows.push([
      `${programNumber}.${String(index + 1).padStart(2, '0')}`,
      `[${key}] ${item.name} — ${item.summary}`,
      primaryLabels[service.serviceId] ?? service.serviceLabel,
      program.supporting,
      `Verify ${service.serviceLabel} “${item.name}” within: ${program.workflow}`,
      program.value,
    ]);
  });
}

const matrixCapabilities = SERVICE_CAPABILITY_AUDITS.flatMap((service) =>
  service.items.map((item) => `${service.serviceId}:${item.id}`),
);
const emittedCapabilities = rows
  .slice(1)
  .map((row) => row[1].match(/^\[([^\]]+)]/)?.[1])
  .filter(Boolean);
if (matrixCapabilities.length !== 170) {
  throw new Error(`Expected 170 canonical capabilities, found ${matrixCapabilities.length}`);
}
if (new Set(matrixCapabilities).size !== matrixCapabilities.length) {
  throw new Error('Canonical capability IDs are not unique');
}
if (
  emittedCapabilities.length !== matrixCapabilities.length ||
  emittedCapabilities.some((key) => !matrixCapabilities.includes(key))
) {
  throw new Error(
    `CSV coverage mismatch: emitted ${emittedCapabilities.length}/${matrixCapabilities.length}`,
  );
}

await fs.writeFile(output, `${rows.map(csvRow).join('\n')}\n`, 'utf8');
console.log(
  JSON.stringify({ output, programs: Object.keys(programs).length, capabilities: emittedCapabilities.length, rows: rows.length - 1 }),
);
