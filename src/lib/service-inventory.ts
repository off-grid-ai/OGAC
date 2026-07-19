import {
  ENTERPRISE_SOURCE_DEFINITIONS,
  type EnterpriseSourceDefinition,
} from './enterprise-source-registry';
import {
  getServiceCapabilityAudit,
  summarizeServiceCapabilityAudit,
  type ServiceCapabilityAudit,
  type ServiceCapabilitySummary,
} from './service-capability-map';
import type { ServiceEntry } from './service-entry';
import {
  READINESS_GATES,
  summarizeReadiness,
  type LogicalServiceTopology,
  type ReadinessEvidence,
  type ReadinessSummary,
} from './service-topology';

export const EXPECTED_PLATFORM_SERVICE_COUNT = 43;
export const EXPECTED_ENTERPRISE_SOURCE_COUNT = 6;
export const EXPECTED_LOGICAL_INVENTORY_COUNT = 49;

export const SERVICE_INVENTORY_FAMILIES = [
  'data',
  'runtime',
  'governance',
  'observability',
  'operations',
  'enterprise-source',
] as const;

export const SERVICE_INVENTORY_OWNERS = ['operations-services', 'data-sources'] as const;

export type ServiceInventoryFamily =
  | 'data'
  | 'runtime'
  | 'governance'
  | 'observability'
  | 'operations'
  | 'enterprise-source'
  | 'unclassified';

export type ServiceInventoryOwner = 'operations-services' | 'data-sources';

export interface ServiceInventoryRoutes {
  list: string;
  detailPattern: string;
  management: string;
  capabilityMap: string | null;
}

export interface ServiceInventoryDeployment {
  processes: readonly string[];
  nodes: readonly string[];
  version: string | null;
  mutableVersion: boolean | null;
  systemOfRecords: readonly string[];
}

export interface LogicalServiceInventoryEntry {
  id: string;
  label: string;
  description: string;
  owner: ServiceInventoryOwner;
  family: ServiceInventoryFamily;
  role: string;
  deployment: ServiceInventoryDeployment;
  readiness: ReadinessSummary;
  readinessEvidence: readonly ReadinessEvidence[];
  capabilityAudit: ServiceCapabilitySummary;
  /** Derived from the capability registry; capability facts are never copied into this registry. */
  productionWorkflowCapabilityIds: readonly string[];
  seededWorkflowEvidence: readonly string[];
  explicitCapabilityGaps: readonly string[];
  routes: ServiceInventoryRoutes;
  nextAction: string;
}

export interface ServiceInventoryIssue {
  code:
    | 'platform-count'
    | 'enterprise-source-count'
    | 'logical-count'
    | 'duplicate-id'
    | 'unclassified-platform';
  message: string;
}

export interface ServiceInventoryReconciliation {
  entries: readonly LogicalServiceInventoryEntry[];
  platformCount: number;
  enterpriseSourceCount: number;
  totalCount: number;
  exactContract: boolean;
  issues: readonly ServiceInventoryIssue[];
}

export interface ServiceInventoryFilter {
  query?: string;
  family?: ServiceInventoryFamily | '';
  owner?: ServiceInventoryOwner | '';
}

type CapabilityAuditLookup = (serviceId: string) => ServiceCapabilityAudit | null;
type CapabilitySummaryLookup = (serviceId: string) => ServiceCapabilitySummary;

export interface ServiceInventoryInput {
  platformServices: readonly ServiceEntry[];
  topologies?: readonly LogicalServiceTopology[];
  capabilityAuditFor?: CapabilityAuditLookup;
  capabilitySummaryFor?: CapabilitySummaryLookup;
}

const PLATFORM_SERVICE_IDS_BY_FAMILY: Readonly<
  Record<Exclude<ServiceInventoryFamily, 'enterprise-source' | 'unclassified'>, readonly string[]>
> = {
  data: [
    'postgres',
    'qdrant',
    'marquez',
    'lancedb',
    'seaweedfs',
    'warehouse',
    'airbyte',
    'streaming',
    'data-quality',
    'kestra',
  ],
  runtime: [
    'gateway',
    'litellm',
    'temporal',
    'gateway-control',
    'agent-worker',
    'app-worker',
    'chat-worker',
  ],
  governance: ['llm-guard', 'keycloak', 'opa', 'openbao', 'unleash', 'presidio'],
  observability: [
    'opensearch',
    'langfuse',
    'evidently',
    'ragas',
    'victoriametrics',
    'victorialogs',
    'otel-collector',
    'jaeger',
  ],
  operations: [
    'console',
    'edge-gateway',
    'provit',
    'redis',
    'superset',
    'fleetdm',
    'cloudflared',
    'landing',
    'status-page',
    'litellm-forwarder',
    'observability-forwarder',
    'fleet-forwarder',
  ],
};

const PLATFORM_FAMILY_BY_ID = new Map<string, ServiceInventoryFamily>(
  Object.entries(PLATFORM_SERVICE_IDS_BY_FAMILY).flatMap(([family, ids]) =>
    ids.map((id) => [id, family as ServiceInventoryFamily] as const),
  ),
);

const UNKNOWN_READINESS: ReadinessSummary = Object.fromEntries(
  READINESS_GATES.map((gate) => [gate, 'unknown']),
) as ReadinessSummary;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function topologyEvidence(topology: LogicalServiceTopology | undefined): ReadinessEvidence[] {
  if (!topology) return [];
  return [
    ...topology.readiness,
    ...topology.components.flatMap((component) => [
      ...component.readiness,
      ...component.instances.flatMap((instance) => instance.readiness),
    ]),
  ];
}

function auditProjection(audit: ServiceCapabilityAudit | null): {
  version: string | null;
  mutableVersion: boolean | null;
  productionWorkflowCapabilityIds: string[];
  explicitCapabilityGaps: string[];
  nextAction: string;
} {
  if (!audit) {
    return {
      version: null,
      mutableVersion: null,
      productionWorkflowCapabilityIds: [],
      explicitCapabilityGaps: [],
      nextAction: 'Audit the pinned upstream denominator before assigning capability coverage.',
    };
  }
  const gaps = audit.items.map((item) => item.gap.trim()).filter(Boolean);
  return {
    version: audit.upstreamVersion,
    mutableVersion: /mutable|latest|main-stable/i.test(audit.upstreamVersion),
    productionWorkflowCapabilityIds: audit.items
      .filter((item) => item.gates.workflow.status === 'yes')
      .map((item) => item.id),
    explicitCapabilityGaps: gaps,
    nextAction: gaps[0] ?? 'Keep the verified four-gate evidence current.',
  };
}

function platformRecord(
  service: ServiceEntry,
  topology: LogicalServiceTopology | undefined,
  audit: ServiceCapabilityAudit | null,
  summary: ServiceCapabilitySummary,
): LogicalServiceInventoryEntry {
  const projection = auditProjection(audit);
  const serviceId = encodeURIComponent(service.id);
  return {
    id: service.id,
    label: service.label,
    description: service.description,
    owner: 'operations-services',
    family: PLATFORM_FAMILY_BY_ID.get(service.id) ?? 'unclassified',
    role: service.kind,
    deployment: {
      processes: unique(topology?.components.map((component) => component.label) ?? []),
      nodes: unique(
        topology?.components.flatMap((component) =>
          component.instances.flatMap((instance) => (instance.nodeId ? [instance.nodeId] : [])),
        ) ?? [],
      ),
      version: projection.version,
      mutableVersion: projection.mutableVersion,
      systemOfRecords: [
        'src/lib/services-directory.ts',
        '../onprem-fleet-orchestration/deploy/onprem/SERVICE_MAP.md',
      ],
    },
    readiness: topology ? summarizeReadiness(topology) : UNKNOWN_READINESS,
    readinessEvidence: topologyEvidence(topology),
    capabilityAudit: summary,
    productionWorkflowCapabilityIds: projection.productionWorkflowCapabilityIds,
    seededWorkflowEvidence: [],
    explicitCapabilityGaps: projection.explicitCapabilityGaps,
    routes: {
      list: '/operations/services',
      detailPattern: '/operations/services/[serviceId]',
      management: `/operations/services/${serviceId}`,
      capabilityMap: `/operations/services/capability-map?service=${serviceId}`,
    },
    nextAction: projection.nextAction,
  };
}

function enterpriseSourceRecord(source: EnterpriseSourceDefinition): LogicalServiceInventoryEntry {
  return {
    id: source.id,
    label: source.label,
    description: source.description,
    owner: 'data-sources',
    family: 'enterprise-source',
    role: source.role,
    deployment: {
      processes: [source.process],
      nodes: [],
      version: source.version,
      mutableVersion: source.mutableVersion,
      systemOfRecords: [source.systemOfRecord],
    },
    readiness: UNKNOWN_READINESS,
    readinessEvidence: [],
    capabilityAudit: { status: 'not-audited' },
    productionWorkflowCapabilityIds: [],
    seededWorkflowEvidence: source.seededWorkflowEvidence,
    explicitCapabilityGaps: [source.nextAction],
    routes: {
      list: source.listRoute,
      detailPattern: source.detailRoutePattern,
      management: source.managementRoute,
      capabilityMap: null,
    },
    nextAction: source.nextAction,
  };
}

/**
 * Reconcile the two IA owners into one logical 49-entry projection without duplicating entities.
 * The function remains pure: callers inject the live service registry/topology, while capability
 * evidence is referenced from the canonical capability registry rather than copied here.
 */
export function reconcileServiceInventory({
  platformServices,
  topologies = [],
  capabilityAuditFor = getServiceCapabilityAudit,
  capabilitySummaryFor = summarizeServiceCapabilityAudit,
}: ServiceInventoryInput): ServiceInventoryReconciliation {
  const topologyByService = new Map(topologies.map((topology) => [topology.service.id, topology]));
  const platformEntries = platformServices.map((service) =>
    platformRecord(
      service,
      topologyByService.get(service.id),
      capabilityAuditFor(service.id),
      capabilitySummaryFor(service.id),
    ),
  );
  const enterpriseEntries = ENTERPRISE_SOURCE_DEFINITIONS.map(enterpriseSourceRecord);
  const entries = [...platformEntries, ...enterpriseEntries];
  const issues: ServiceInventoryIssue[] = [];

  if (platformEntries.length !== EXPECTED_PLATFORM_SERVICE_COUNT) {
    issues.push({
      code: 'platform-count',
      message: `Expected ${EXPECTED_PLATFORM_SERVICE_COUNT} platform entries; received ${platformEntries.length}.`,
    });
  }
  if (enterpriseEntries.length !== EXPECTED_ENTERPRISE_SOURCE_COUNT) {
    issues.push({
      code: 'enterprise-source-count',
      message: `Expected ${EXPECTED_ENTERPRISE_SOURCE_COUNT} enterprise sources; received ${enterpriseEntries.length}.`,
    });
  }
  if (entries.length !== EXPECTED_LOGICAL_INVENTORY_COUNT) {
    issues.push({
      code: 'logical-count',
      message: `Expected ${EXPECTED_LOGICAL_INVENTORY_COUNT} logical entries; received ${entries.length}.`,
    });
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      issues.push({
        code: 'duplicate-id',
        message: `Duplicate logical inventory id: ${entry.id}.`,
      });
    }
    seen.add(entry.id);
  }
  for (const entry of platformEntries.filter((item) => item.family === 'unclassified')) {
    issues.push({
      code: 'unclassified-platform',
      message: `Platform service ${entry.id} has no inventory family.`,
    });
  }

  return {
    entries,
    platformCount: platformEntries.length,
    enterpriseSourceCount: enterpriseEntries.length,
    totalCount: entries.length,
    exactContract: issues.length === 0,
    issues,
  };
}

/** URL-filterable inventory refinement. An empty filter always preserves the exact source order. */
export function filterServiceInventory(
  entries: readonly LogicalServiceInventoryEntry[],
  { query = '', family = '', owner = '' }: ServiceInventoryFilter,
): LogicalServiceInventoryEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (family && entry.family !== family) return false;
    if (owner && entry.owner !== owner) return false;
    if (!needle) return true;
    return [
      entry.id,
      entry.label,
      entry.description,
      entry.family,
      entry.role,
      entry.owner,
      entry.nextAction,
    ].some((value) => value.toLowerCase().includes(needle));
  });
}

export function isServiceInventoryFamily(value: string): value is ServiceInventoryFamily {
  return (SERVICE_INVENTORY_FAMILIES as readonly string[]).includes(value);
}

export function isServiceInventoryOwner(value: string): value is ServiceInventoryOwner {
  return (SERVICE_INVENTORY_OWNERS as readonly string[]).includes(value);
}
