import type { ServiceEntry } from '../service-entry';
import {
  READINESS_GATES,
  type LogicalServiceTopology,
  type ReadinessEvidence,
  type ReadinessState,
  type ServiceComponent,
  type ServiceDependency,
  type ServiceEndpoint,
} from '../service-topology';

export interface ServiceTopologyRecord {
  serviceId: string;
  components: ServiceComponent[];
  dependencies?: ServiceDependency[];
  readiness?: ReadinessEvidence[];
}

export interface ServiceTopologySource {
  listServices(): readonly ServiceEntry[];
  listTopologyRecords(): readonly ServiceTopologyRecord[];
}

export interface ServiceTopologyRegistry {
  list(): LogicalServiceTopology[];
  find(serviceId: string): LogicalServiceTopology | undefined;
}

const READINESS_STATES = new Set<ReadinessState>(['pass', 'fail', 'unknown', 'not-applicable']);
const ENDPOINT_SCOPES = new Set<ServiceEndpoint['scope']>([
  'public',
  'lan',
  'loopback',
  'in-process',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseEvidence(value: unknown): ReadinessEvidence | null {
  if (!isObject(value)) return null;
  if (!READINESS_GATES.includes(value.gate as (typeof READINESS_GATES)[number])) return null;
  if (!READINESS_STATES.has(value.state as ReadinessState)) return null;
  if (!nonEmptyString(value.summary) || !nonEmptyString(value.source)) return null;
  if (value.observedAt !== undefined && !nonEmptyString(value.observedAt)) return null;
  return {
    gate: value.gate as ReadinessEvidence['gate'],
    state: value.state as ReadinessState,
    summary: value.summary,
    source: value.source,
    ...(value.observedAt ? { observedAt: value.observedAt as string } : {}),
  };
}

function parseEndpoint(value: unknown): ServiceEndpoint | null {
  if (!isObject(value)) return null;
  if (
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.label) ||
    !nonEmptyString(value.url) ||
    !nonEmptyString(value.purpose) ||
    !ENDPOINT_SCOPES.has(value.scope as ServiceEndpoint['scope'])
  ) {
    return null;
  }
  return {
    id: value.id,
    label: value.label,
    url: value.url,
    purpose: value.purpose,
    scope: value.scope as ServiceEndpoint['scope'],
  };
}

function parseComponent(value: unknown): ServiceComponent | null {
  if (!isObject(value)) return null;
  if (!nonEmptyString(value.id) || !nonEmptyString(value.label) || !nonEmptyString(value.role)) {
    return null;
  }
  if (!Array.isArray(value.instances) || !Array.isArray(value.readiness)) return null;
  const readiness = value.readiness.map(parseEvidence);
  if (readiness.some((item) => item === null)) return null;
  const instances = value.instances.map((instance) => {
    if (!isObject(instance)) return null;
    if (
      !nonEmptyString(instance.id) ||
      !nonEmptyString(instance.label) ||
      (instance.nodeId !== null && !nonEmptyString(instance.nodeId)) ||
      !Array.isArray(instance.endpoints) ||
      !Array.isArray(instance.readiness)
    ) {
      return null;
    }
    const endpoints = instance.endpoints.map(parseEndpoint);
    const instanceReadiness = instance.readiness.map(parseEvidence);
    if (endpoints.some((endpoint) => endpoint === null) || instanceReadiness.some((e) => !e)) {
      return null;
    }
    return {
      id: instance.id,
      label: instance.label,
      nodeId: instance.nodeId as string | null,
      endpoints: endpoints as ServiceEndpoint[],
      readiness: instanceReadiness as ReadinessEvidence[],
    };
  });
  if (instances.some((instance) => instance === null)) return null;
  return {
    id: value.id,
    label: value.label,
    role: value.role,
    instances: instances as ServiceComponent['instances'],
    readiness: readiness as ReadinessEvidence[],
  };
}

function parseDependency(value: unknown): ServiceDependency | null {
  if (!isObject(value)) return null;
  if (
    !nonEmptyString(value.serviceId) ||
    !nonEmptyString(value.purpose) ||
    typeof value.required !== 'boolean'
  ) {
    return null;
  }
  return { serviceId: value.serviceId, purpose: value.purpose, required: value.required };
}

function parseRecord(value: unknown): ServiceTopologyRecord | null {
  if (!isObject(value) || !nonEmptyString(value.serviceId) || !Array.isArray(value.components)) {
    return null;
  }
  const components = value.components.map(parseComponent);
  const dependencies = Array.isArray(value.dependencies)
    ? value.dependencies.map(parseDependency)
    : [];
  const readiness = Array.isArray(value.readiness) ? value.readiness.map(parseEvidence) : [];
  if (
    components.some((component) => component === null) ||
    dependencies.some((dependency) => dependency === null) ||
    readiness.some((item) => item === null)
  ) {
    return null;
  }
  return {
    serviceId: value.serviceId,
    components: components as ServiceComponent[],
    dependencies: dependencies as ServiceDependency[],
    readiness: readiness as ReadinessEvidence[],
  };
}

/** Parse the optional deployment-owned topology document. Invalid input fails closed to no rows. */
export function parseServiceTopologyRecords(
  serialized: string | undefined,
): ServiceTopologyRecord[] {
  if (!serialized) return [];
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return [];
    const records = value.map(parseRecord);
    return records.some((record) => record === null) ? [] : (records as ServiceTopologyRecord[]);
  } catch {
    return [];
  }
}

function endpointScope(url: string): ServiceEndpoint['scope'] {
  if (url.startsWith('embedded:')) return 'in-process';
  try {
    const hostname = new URL(url).hostname;
    if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') {
      return 'loopback';
    }
    if (hostname.endsWith('.local')) return 'lan';
  } catch {
    return 'in-process';
  }
  return 'public';
}

function nodeFromUrl(url: string): string | null {
  if (url.startsWith('embedded:')) return null;
  try {
    const hostname = new URL(url).hostname;
    const match = hostname.match(/^offgrid-(s1|g\d+)\.local$/);
    if (match) return match[1] ?? null;
    if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') return 's1';
  } catch {
    return null;
  }
  return null;
}

function baselineReadiness(service: ServiceEntry): ReadinessEvidence[] {
  const embedded = service.probe === 'embedded';
  return [
    {
      gate: 'deployed',
      state: embedded ? 'pass' : 'unknown',
      summary: embedded
        ? 'Runs in-process with the console.'
        : 'Registry presence does not prove a deployed process.',
      source: 'service registry',
    },
    {
      gate: 'reachable',
      state: 'unknown',
      summary: 'Resolved by the live service probe.',
      source: 'health API',
    },
    {
      gate: 'functional',
      state: 'unknown',
      summary: 'No production transaction evidence is registered.',
      source: 'service registry',
    },
    {
      gate: 'seeded',
      state: 'not-applicable',
      summary: 'No seed requirement is declared for this service.',
      source: 'service registry',
    },
    {
      gate: 'console-used',
      state: 'unknown',
      summary: 'Directory visibility does not prove a console production call path.',
      source: 'service registry',
    },
  ];
}

function defaultTopology(service: ServiceEntry): LogicalServiceTopology {
  return {
    service,
    dependencies: [],
    readiness: baselineReadiness(service),
    components: [
      {
        id: `${service.id}-runtime`,
        label: `${service.label} runtime`,
        role: service.kind,
        readiness: [],
        instances: [
          {
            id: `${service.id}-primary`,
            label: 'Primary instance',
            nodeId: nodeFromUrl(service.url),
            endpoints: [
              {
                id: `${service.id}-primary`,
                label: 'Primary endpoint',
                url: service.url,
                purpose: 'Service access and readiness probing',
                scope: endpointScope(service.url),
              },
            ],
            readiness: [],
          },
        ],
      },
    ],
  };
}

export function createServiceTopologyRegistry(
  source: ServiceTopologySource,
): ServiceTopologyRegistry {
  function list(): LogicalServiceTopology[] {
    const records = new Map(
      source.listTopologyRecords().map((record) => [record.serviceId, record]),
    );
    return source.listServices().map((service) => {
      const record = records.get(service.id);
      if (!record) return defaultTopology(service);
      return {
        service,
        components: record.components,
        dependencies: record.dependencies ?? [],
        readiness: record.readiness ?? [],
      };
    });
  }

  return {
    list,
    find(serviceId) {
      return list().find((topology) => topology.service.id === serviceId);
    },
  };
}
