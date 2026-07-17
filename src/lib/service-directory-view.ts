import { toDisplayHost } from './display-host';
import type { ServiceEntry } from './service-entry';
import {
  countInstances,
  summarizeReadiness,
  type LogicalServiceTopology,
  type ReadinessEvidence,
  type ReadinessSummary,
  type ServiceDependency,
} from './service-topology';

/**
 * Browser-safe projection of the server-owned service registry.
 *
 * `ServiceEntry.url` is a connection target used by server-side probes and may contain database
 * credentials, API tokens, private paths, or query parameters. It must never cross the React
 * Server Component boundary. The directory only needs a safe HTTP(S) origin for an optional
 * operator link, so this DTO deliberately excludes every probe/control field and the raw URL.
 */
export interface ServiceDirectoryEntry {
  id: string;
  label: string;
  description: string;
  displayUrl: string | null;
  auth: ServiceEntry['auth'];
  kind: ServiceEntry['kind'];
}

export interface ServiceDetailEntry extends ServiceDirectoryEntry {
  /** Allow-listed management surface; raw probe configuration remains server-only. */
  management?: 'redpanda';
}

export interface ServiceTopologyDirectoryEntry extends ServiceDirectoryEntry {
  componentCount: number;
  instanceCount: number;
  readiness: ReadinessSummary;
}

export interface ServiceEndpointView {
  id: string;
  label: string;
  purpose: string;
  scope: 'public' | 'lan' | 'loopback' | 'in-process';
  displayUrl: string | null;
}

export interface ServiceInstanceView {
  id: string;
  label: string;
  nodeId: string | null;
  endpoints: ServiceEndpointView[];
  readiness: ReadinessEvidence[];
}

export interface ServiceComponentView {
  id: string;
  label: string;
  role: string;
  instances: ServiceInstanceView[];
  readiness: ReadinessEvidence[];
}

export interface ServiceTopologyDetailEntry extends ServiceTopologyDirectoryEntry {
  management?: 'redpanda';
  components: ServiceComponentView[];
  dependencies: ServiceDependency[];
  evidence: ReadinessEvidence[];
}

/**
 * Convert a server connection target into the only URL form the directory may serialize.
 *
 * Non-HTTP connection strings are not browser destinations and are omitted. For HTTP(S), only the
 * display-mapped origin survives: userinfo, path, query parameters, and fragments are discarded.
 * This is intentionally stricter than redacting known secret parameter names because allow-listing
 * the origin prevents newly named credentials from leaking later.
 */
export function toSafeServiceDisplayUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  // Build from the parsed origin rather than mutating/returning the input so no userinfo, path,
  // query, or fragment can survive this projection.
  return toDisplayHost(parsed.origin);
}

export function toServiceDirectoryEntry(service: ServiceEntry): ServiceDirectoryEntry {
  return {
    id: service.id,
    label: service.label,
    description: service.description,
    displayUrl: toSafeServiceDisplayUrl(service.url),
    auth: service.auth,
    kind: service.kind,
  };
}

export function toServiceDirectoryEntries(
  services: readonly ServiceEntry[],
): ServiceDirectoryEntry[] {
  return services.map(toServiceDirectoryEntry);
}

export function toServiceDetailEntry(service: ServiceEntry): ServiceDetailEntry {
  return {
    ...toServiceDirectoryEntry(service),
    ...(service.management === 'redpanda' ? { management: 'redpanda' as const } : {}),
  };
}

export function toServiceTopologyDirectoryEntry(
  topology: LogicalServiceTopology,
): ServiceTopologyDirectoryEntry {
  return {
    ...toServiceDirectoryEntry(topology.service),
    componentCount: topology.components.length,
    instanceCount: countInstances(topology),
    readiness: summarizeReadiness(topology),
  };
}

export function toServiceTopologyDirectoryEntries(
  topologies: readonly LogicalServiceTopology[],
): ServiceTopologyDirectoryEntry[] {
  return topologies.map(toServiceTopologyDirectoryEntry);
}

export function toServiceTopologyDetailEntry(
  topology: LogicalServiceTopology,
): ServiceTopologyDetailEntry {
  return {
    ...toServiceTopologyDirectoryEntry(topology),
    ...(topology.service.management === 'redpanda' ? { management: 'redpanda' as const } : {}),
    components: topology.components.map((component) => ({
      id: component.id,
      label: component.label,
      role: component.role,
      readiness: component.readiness,
      instances: component.instances.map((instance) => ({
        id: instance.id,
        label: instance.label,
        nodeId: instance.nodeId,
        readiness: instance.readiness,
        endpoints: instance.endpoints.map((endpoint) => ({
          id: endpoint.id,
          label: endpoint.label,
          purpose: endpoint.purpose,
          scope: endpoint.scope,
          displayUrl: toSafeServiceDisplayUrl(endpoint.url),
        })),
      })),
    })),
    dependencies: topology.dependencies,
    evidence: [
      ...topology.readiness,
      ...topology.components.flatMap((component) => [
        ...component.readiness,
        ...component.instances.flatMap((instance) => instance.readiness),
      ]),
    ],
  };
}
